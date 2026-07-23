import { useCallback, useRef } from 'react';

import { type SharedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { playGameSfx } from '@/src/pose-module/audio/gameAudio';
import { triggerHaptics } from '@/src/services/haptics';

import type { PushUpSignal } from '../signal';

import { climbAfterHeave, climbAfterSlip, isLastLevel, levelAt, readyToDeliver } from './haul';
import { HAULER_TIMING } from './haulerConfig';

const T = HAULER_TIMING;

export interface HaulResult {
	totalDelivered: number;
	weightKg: number;
	levelsCleared: number;
	timeMs: number;
	/** True when the whole roster was hauled, false when Stop ended it early. */
	completed: boolean;
}

/** Carry = the monster is hoisting the load up; return = climbing back empty. */
export type HaulPhase = 0 | 1; // 0 = carry, 1 = return

export interface HaulerEngine {
	running: SharedValue<boolean>;
	/** True from Start until the calibration rep — the monster braces at the base. */
	awaitingRep: SharedValue<boolean>;
	calibrated: SharedValue<boolean>;
	paused: SharedValue<boolean>;
	/** Monotonic clock (ms) that always advances while running — drives ambience. */
	nowMs: SharedValue<number>;
	/** Current load, 0 = at the base, 1 = dropped on the top ledge. */
	climb: SharedValue<number>;
	/** 1 → 0 pulse on each push-up: the heave lunge on the monster's body. */
	heaveT: SharedValue<number>;
	/** 1 → 0 pulse for screen shake (heave + delivery). */
	shakeT: SharedValue<number>;
	/** 0 = carry, 1 = returning to the base for the next piece. */
	phase: SharedValue<HaulPhase>;
	/** 0 → 1 progress of the empty climb-down between pieces. */
	returnT: SharedValue<number>;
	levelIndex: SharedValue<number>;
	/** Pieces delivered in the current level. */
	deliveredInLevel: SharedValue<number>;
	totalDelivered: SharedValue<number>;
	weightKg: SharedValue<number>;
	elapsedMs: SharedValue<number>;
	/** Timestamp (nowMs) of the last heave — drives foot-dust bursts. */
	heaveAt: SharedValue<number>;
	/** Timestamp (nowMs) of the last delivery — drives rubble bursts. */
	deliverAt: SharedValue<number>;
	/** 1 → 0 level-up banner beat. */
	bannerT: SharedValue<number>;
	begin: () => void;
	/** Call on every counted rep: first rep braces + heaves, the rest heave. */
	rep: () => void;
	halt: () => void;
}

export interface UseHaulerEngineConfig {
	signal: PushUpSignal;
	onFinished: (result: HaulResult) => void;
}

/**
 * The Push Hauler loop. Each push-up heaves the load a notch up the cliff; if
 * the athlete rests the load slips back, so steady work is what reaches the top
 * ledge. On delivery the monster drops the piece (thud + shake + rubble), climbs
 * back down empty, and grabs the next one. Clearing a level's pieces advances
 * the roster to a heavier cargo. Everything runs inside one `useFrameCallback`
 * worklet — the JS thread starves under camera + MediaPipe load (field-learned
 * on Flappy), so only discrete rep events cross from JS.
 */
export function useHaulerEngine({ signal, onFinished }: UseHaulerEngineConfig): HaulerEngine {
	const running = useSharedValue(false);
	const awaitingRep = useSharedValue(false);
	const calibrated = useSharedValue(false);
	const paused = useSharedValue(false);
	const ended = useSharedValue(false);
	const signalLostAt = useSharedValue(-1);

	const nowMs = useSharedValue(0);
	const climb = useSharedValue(0);
	const heaveT = useSharedValue(0);
	const shakeT = useSharedValue(0);
	const phase = useSharedValue<HaulPhase>(0);
	const returnT = useSharedValue(0);
	const levelIndex = useSharedValue(0);
	const deliveredInLevel = useSharedValue(0);
	const totalDelivered = useSharedValue(0);
	const weightKg = useSharedValue(0);
	const elapsedMs = useSharedValue(0);
	const heaveAt = useSharedValue(-99999);
	const deliverAt = useSharedValue(-99999);
	const bannerT = useSharedValue(0);

	const onFinishedRef = useRef(onFinished);
	onFinishedRef.current = onFinished;

	const finishOnRN = useCallback((result: HaulResult) => {
		playGameSfx('fanfare');
		triggerHaptics('success');
		onFinishedRef.current(result);
	}, []);
	const deliverOnRN = useCallback(() => {
		playGameSfx('thud');
		triggerHaptics('impactHeavy');
	}, []);
	const levelUpOnRN = useCallback(() => {
		playGameSfx('levelup');
		triggerHaptics('success');
	}, []);

	useFrameCallback(frameInfo => {
		'worklet';
		if (!running.value || ended.value) return;

		const dt = Math.max(1, Math.min(frameInfo.timeSincePreviousFrame ?? 16, T.MAX_FRAME_DT_MS));
		nowMs.value += dt;

		// --- Signal watch: pause (freeze the whole haul) on sustained loss ---
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

		// Pulses decay on the UI clock regardless of stage.
		if (heaveT.value > 0) heaveT.value = Math.max(0, heaveT.value - dt / T.HEAVE_DECAY_MS);
		if (shakeT.value > 0) shakeT.value = Math.max(0, shakeT.value - dt / T.SHAKE_MS);
		if (bannerT.value > 0) bannerT.value = Math.max(0, bannerT.value - dt / T.BANNER_MS);

		// The monster braces at the base until the calibration rep.
		if (!calibrated.value) return;

		elapsedMs.value += dt;

		const level = levelAt(levelIndex.value);

		// --- Return trip: auto climb-down between pieces ---
		if (phase.value === 1) {
			returnT.value = Math.min(1, returnT.value + dt / T.RETURN_MS);
			if (returnT.value >= 1) {
				phase.value = 0;
				returnT.value = 0;
				climb.value = 0;
			}
			return;
		}

		// --- Carry: deliver the moment the load reaches the top, else slip back
		// if the athlete stops repping. The delivery check must run before the
		// slip, or a load pushed to the top is nibbled below 1 before it counts.
		if (readyToDeliver(climb.value)) {
			climb.value = 1;
			deliveredInLevel.value += 1;
			totalDelivered.value += 1;
			weightKg.value += level.weightKg;
			deliverAt.value = nowMs.value;
			shakeT.value = 1;
			scheduleOnRN(deliverOnRN);

			if (deliveredInLevel.value >= level.count) {
				if (isLastLevel(levelIndex.value)) {
					ended.value = true;
					scheduleOnRN(finishOnRN, {
						totalDelivered: totalDelivered.value,
						weightKg: weightKg.value,
						levelsCleared: levelIndex.value + 1,
						timeMs: elapsedMs.value,
						completed: true,
					});
					return;
				}
				levelIndex.value += 1;
				deliveredInLevel.value = 0;
				bannerT.value = 1;
				scheduleOnRN(levelUpOnRN);
			}

			phase.value = 1;
			returnT.value = 0;
		} else {
			climb.value = climbAfterSlip(climb.value, level, dt);
		}
	});

	const begin = useCallback(() => {
		signalLostAt.value = -1;
		paused.value = false;
		ended.value = false;
		nowMs.value = 0;
		climb.value = 0;
		heaveT.value = 0;
		shakeT.value = 0;
		phase.value = 0;
		returnT.value = 0;
		levelIndex.value = 0;
		deliveredInLevel.value = 0;
		totalDelivered.value = 0;
		weightKg.value = 0;
		elapsedMs.value = 0;
		heaveAt.value = -99999;
		deliverAt.value = -99999;
		bannerT.value = 0;
		awaitingRep.value = true;
		calibrated.value = false;
		running.value = true;
	}, [
		signalLostAt, paused, ended, nowMs, climb, heaveT, shakeT, phase, returnT,
		levelIndex, deliveredInLevel, totalDelivered, weightKg, elapsedMs, heaveAt,
		deliverAt, bannerT, awaitingRep, calibrated, running,
	]);

	const rep = useCallback(() => {
		if (!running.value || ended.value || paused.value) return;

		// The calibration rep braces the monster and lands the first heave.
		if (awaitingRep.value) {
			awaitingRep.value = false;
			calibrated.value = true;
			bannerT.value = 0;
		}
		// Reps during the empty climb-down do nothing but keep the athlete moving.
		if (phase.value === 1) return;

		const level = levelAt(levelIndex.value);
		climb.value = climbAfterHeave(climb.value, level);
		heaveT.value = 1;
		heaveAt.value = nowMs.value;
		shakeT.value = Math.max(shakeT.value, 0.45);
		playGameSfx('grunt');
		playGameSfx('scrape');
		triggerHaptics('impactMedium');
	}, [running, ended, paused, awaitingRep, calibrated, phase, levelIndex, climb, heaveT, heaveAt, shakeT, nowMs, bannerT]);

	const halt = useCallback(() => {
		running.value = false;
	}, [running]);

	return {
		running,
		awaitingRep,
		calibrated,
		paused,
		nowMs,
		climb,
		heaveT,
		shakeT,
		phase,
		returnT,
		levelIndex,
		deliveredInLevel,
		totalDelivered,
		weightKg,
		elapsedMs,
		heaveAt,
		deliverAt,
		bannerT,
		begin,
		rep,
		halt,
	};
}
