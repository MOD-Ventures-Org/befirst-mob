import { useCallback, useRef } from 'react';

import { type SharedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { playGameSfx } from '@/src/pose-module/audio/gameAudio';
import { triggerHaptics } from '@/src/services/haptics';

import type { PushUpSignal } from '../signal';

import { FLAPPY_GEOMETRY, FLAPPY_TIMING } from './flappyConfig';
import { type FlappyGeom, resolveGateFrame } from './gate';
import type { FlappyLevel } from './levels';

const T = FLAPPY_TIMING;

export interface FlappyEngine {
	smoothedPos: SharedValue<number>;
	tilt: SharedValue<number>;
	worldX: SharedValue<number>;
	score: SharedValue<number>;
	coins: SharedValue<number>;
	activeGate: SharedValue<number>;
	hitFlash: SharedValue<number>;
	paused: SharedValue<boolean>;
	running: SharedValue<boolean>;
	/** True from Start until the calibration rep — bird flies, world frozen. */
	awaitingRep: SharedValue<boolean>;
	/** True once the first rep started the run — the world is scrolling. */
	calibrated: SharedValue<boolean>;
	/** False while the wrists read as lifted off the floor during active play. */
	palmsPlanted: SharedValue<boolean>;
	geomSV: SharedValue<FlappyGeom | null>;
	levelSV: SharedValue<FlappyLevel | null>;
	/** Two most recently resolved coins (taken or forfeited) stay hidden. */
	coinGoneA: SharedValue<number>;
	coinGoneB: SharedValue<number>;
	configure: (level: FlappyLevel, geom: FlappyGeom) => void;
	begin: () => void;
	/** Call on the first counted rep: starts the run immediately (idempotent). */
	startRun: () => void;
	halt: () => void;
}

export interface UseFlappyEngineConfig {
	signal: PushUpSignal;
	onFinished: (score: number, coins: number) => void;
}

/** World-space X of a slot's leading edge. Slots enter from the right edge. */
export function slotWorldX(index: number, geom: FlappyGeom): number {
	'worklet';
	return geom.bandW + index * geom.pipeW * FLAPPY_GEOMETRY.SLOT_WIDTH_PIPES;
}

/**
 * The Flappy Push game loop. Everything lives in Reanimated shared values and
 * advances inside one `useFrameCallback` worklet with delta-time movement —
 * zero React re-renders during gameplay. The plane follows the PushUpSignal
 * from the moment the session starts; the world only starts scrolling after
 * the calibration rep (`markCalibrated`), so the athlete's first push-up
 * teaches the engine where "top" and "bottom" are.
 */
export function useFlappyEngine({ signal, onFinished }: UseFlappyEngineConfig): FlappyEngine {
	const smoothedPos = useSharedValue(1);
	const prevPos = useSharedValue(1);
	const tilt = useSharedValue(0);
	const worldX = useSharedValue(0);
	const score = useSharedValue(0);
	const coins = useSharedValue(0);
	const activeGate = useSharedValue(0);
	const gateHit = useSharedValue(false);
	const coinTaken = useSharedValue(false);
	const hitFlash = useSharedValue(0);
	const signalLostAt = useSharedValue(-1);
	const paused = useSharedValue(false);
	const running = useSharedValue(false);
	const awaitingRep = useSharedValue(false);
	const calibrated = useSharedValue(false);
	const ended = useSharedValue(false);
	const geomSV = useSharedValue<FlappyGeom | null>(null);
	const levelSV = useSharedValue<FlappyLevel | null>(null);
	const coinGoneA = useSharedValue(-1);
	const coinGoneB = useSharedValue(-1);

	const onFinishedRef = useRef(onFinished);
	onFinishedRef.current = onFinished;
	const finishOnRN = useCallback((finalScore: number, finalCoins: number) => {
		playGameSfx('fanfare');
		onFinishedRef.current(finalScore, finalCoins);
	}, []);

	useFrameCallback(frameInfo => {
		'worklet';
		if (!running.value || ended.value) return;
		const geom = geomSV.value;
		const level = levelSV.value;
		if (!geom || !level || level.topFrac.length === 0) return;

		// Clamp BOTH ends: a 0 ms delta divides the climb rate by zero and the
		// resulting NaN tilt would hide the bird permanently (field bug).
		const dt = Math.max(1, Math.min(frameInfo.timeSincePreviousFrame ?? 16, T.MAX_FRAME_DT_MS));

		// --- Signal watch: pause after sustained loss, resume seamlessly ---
		const lost = !signal.personDetected.value || signal.confidence.value < T.CONFIDENCE_MIN;
		if (lost) {
			if (signalLostAt.value < 0) {
				signalLostAt.value = frameInfo.timestamp;
			} else if (frameInfo.timestamp - signalLostAt.value > T.SIGNAL_LOST_MS) {
				paused.value = true;
			}
		} else {
			signalLostAt.value = -1;
			paused.value = false;
		}
		if (paused.value) return;

		// The bird holds level at the top until the first rep starts the run, so
		// it never tracks the body while the athlete is only getting into
		// position (the live signal is ignored until calibrated).
		if (!calibrated.value) {
			smoothedPos.value = 1;
			prevPos.value = 1;
			tilt.value = 0;
			return;
		}

		// --- Display EMA: time-corrected so the alpha is frame-rate independent ---
		const alpha = 1 - Math.exp(-dt / T.EMA_TAU_MS);
		smoothedPos.value += alpha * (signal.position.value - smoothedPos.value);

		// Plane tilt follows the climb rate (nose up while rising), smoothed.
		const climbRate = ((smoothedPos.value - prevPos.value) / dt) * 1000;
		prevPos.value = smoothedPos.value;
		const tiltTarget = Math.min(0.45, Math.max(-0.45, -climbRate * 0.35));
		tilt.value += alpha * (tiltTarget - tilt.value);

		// --- World scroll (delta-time) ---
		const speed = geom.bandW / T.SECONDS_PER_GATE;
		worldX.value += (speed * dt) / 1000;

		// --- Active slot resolution ---
		const slotW = geom.pipeW * FLAPPY_GEOMETRY.SLOT_WIDTH_PIPES;
		const gateIdx = activeGate.value;
		if (gateIdx < level.topFrac.length) {
			const slotScreenX = slotWorldX(gateIdx, geom) - worldX.value;
			const planeY = geom.playTop + (1 - smoothedPos.value) * geom.playH;
			const planeLeft = geom.planeX - geom.planeW / 2;

			if (level.hasPipe[gateIdx]) {
				const events = resolveGateFrame(
					planeY,
					slotScreenX,
					level.topFrac[gateIdx],
					level.bottomFrac[gateIdx],
					geom,
					gateHit.value,
					coinTaken.value,
				);

				if (events.hitNow) {
					// A hit never stops the set — it just flashes and forfeits the
					// slot's coin bonus (spec §4: no death in v1).
					gateHit.value = true;
					hitFlash.value = 1;
					coinGoneB.value = coinGoneA.value;
					coinGoneA.value = gateIdx;
					scheduleOnRN(playGameSfx, 'hit');
					scheduleOnRN(triggerHaptics, 'impactMedium');
				}
				if (events.coinNow) {
					coinTaken.value = true;
					score.value += 2;
					coins.value += 1;
					coinGoneB.value = coinGoneA.value;
					coinGoneA.value = gateIdx;
					scheduleOnRN(playGameSfx, 'coin');
					scheduleOnRN(triggerHaptics, 'impactLight');
				}
				if (events.passedNow) {
					score.value += 1;
					if (!gateHit.value) {
						scheduleOnRN(playGameSfx, 'point');
					}
					activeGate.value = gateIdx + 1;
					gateHit.value = false;
					coinTaken.value = false;
				}
			} else if (slotScreenX + slotW < planeLeft) {
				// Empty breather slot: no score, no coin — just advance.
				activeGate.value = gateIdx + 1;
			}
		}

		// --- Hit flash decay ---
		if (hitFlash.value > 0) {
			hitFlash.value = Math.max(0, hitFlash.value - dt / T.HIT_FLASH_DECAY_MS);
		}

		// --- End of level: the last slot has scrolled past the plane ---
		const lastSlotGone =
			slotWorldX(level.topFrac.length - 1, geom) - worldX.value + slotW < geom.planeX - geom.planeW;
		if (lastSlotGone) {
			ended.value = true;
			scheduleOnRN(finishOnRN, score.value, coins.value);
		}
	});

	const configure = useCallback(
		(level: FlappyLevel, geom: FlappyGeom) => {
			levelSV.value = level;
			geomSV.value = geom;
		},
		[levelSV, geomSV],
	);

	const begin = useCallback(() => {
		smoothedPos.value = 1;
		prevPos.value = 1;
		tilt.value = 0;
		worldX.value = 0;
		score.value = 0;
		coins.value = 0;
		activeGate.value = 0;
		gateHit.value = false;
		coinTaken.value = false;
		hitFlash.value = 0;
		signalLostAt.value = -1;
		paused.value = false;
		awaitingRep.value = true;
		calibrated.value = false;
		ended.value = false;
		coinGoneA.value = -1;
		coinGoneB.value = -1;
		running.value = true;
	}, [
		smoothedPos, prevPos, tilt, worldX, score, coins, activeGate, gateHit, coinTaken,
		hitFlash, signalLostAt, paused, awaitingRep, calibrated, ended, coinGoneA, coinGoneB, running,
	]);

	// The calibration rep is done (spec: "the game should not start until I do
	// 1 push-up rep") — the run starts right away, no countdown.
	const startRun = useCallback(() => {
		if (!awaitingRep.value) return;
		awaitingRep.value = false;
		calibrated.value = true;
		playGameSfx('go');
		triggerHaptics('success');
	}, [awaitingRep, calibrated]);

	const halt = useCallback(() => {
		running.value = false;
	}, [running]);

	return {
		smoothedPos,
		tilt,
		worldX,
		score,
		coins,
		activeGate,
		hitFlash,
		paused,
		running,
		awaitingRep,
		calibrated,
		palmsPlanted: signal.palmsPlanted,
		geomSV,
		levelSV,
		coinGoneA,
		coinGoneB,
		configure,
		begin,
		startRun,
		halt,
	};
}
