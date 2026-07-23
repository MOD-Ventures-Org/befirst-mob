import { useCallback, useRef } from 'react';

import { type SharedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { playGameSfx } from '@/src/pose-module/audio/gameAudio';
import { triggerHaptics } from '@/src/services/haptics';

import type { PushUpSignal } from '../signal';

import { botSpeed, energyAfter, energyAfterRep, rankOf, speedForEnergy } from './physics';
import { RACE_PHYSICS, RACE_TIMING } from './raceConfig';

const T = RACE_TIMING;
const P = RACE_PHYSICS;

export interface RaceResult {
	place: number;
	timeMs: number;
	distanceM: number;
	bestLeadM: number;
	finished: boolean;
}

export interface RaceEngine {
	running: SharedValue<boolean>;
	/** True from Start until the calibration rep — the field waits at the line. */
	awaitingRep: SharedValue<boolean>;
	calibrated: SharedValue<boolean>;
	paused: SharedValue<boolean>;
	playerDist: SharedValue<number>;
	playerSpeed: SharedValue<number>;
	energy: SharedValue<number>;
	botDist0: SharedValue<number>;
	botDist1: SharedValue<number>;
	botDist2: SharedValue<number>;
	botSpeed0: SharedValue<number>;
	botSpeed1: SharedValue<number>;
	botSpeed2: SharedValue<number>;
	rank: SharedValue<number>;
	elapsedMs: SharedValue<number>;
	bestLead: SharedValue<number>;
	/** 1 → 0 "GO!" banner beat after the calibration rep. */
	goT: SharedValue<number>;
	begin: () => void;
	/** Call on every counted rep: first rep fires the pistol, the rest pump energy. */
	rep: () => void;
	halt: () => void;
}

export interface UseRaceEngineConfig {
	signal: PushUpSignal;
	onFinished: (result: RaceResult) => void;
}

/**
 * The Push Race loop. Reps pump an energy tank that decays on the UI-thread
 * clock; the athlete's speed follows the tank, three bots cruise below the
 * slow-cadence pace (steady work always outruns them) with rubber-banding so
 * a hard sprint buys real rest and a long rest lets them pass. The race and
 * every timer advance inside one `useFrameCallback` worklet — the JS thread
 * starves under camera + MediaPipe load (field-learned on Flappy).
 */
export function useRaceEngine({ signal, onFinished }: UseRaceEngineConfig): RaceEngine {
	const running = useSharedValue(false);
	const awaitingRep = useSharedValue(false);
	const calibrated = useSharedValue(false);
	const paused = useSharedValue(false);
	const ended = useSharedValue(false);
	const signalLostAt = useSharedValue(-1);

	const playerDist = useSharedValue(0);
	const playerSpeed = useSharedValue(0);
	const energy = useSharedValue(0);
	const botDist0 = useSharedValue(0);
	const botDist1 = useSharedValue(0);
	const botDist2 = useSharedValue(0);
	const botSpeed0 = useSharedValue(0);
	const botSpeed1 = useSharedValue(0);
	const botSpeed2 = useSharedValue(0);
	const botAhead0 = useSharedValue(false);
	const botAhead1 = useSharedValue(false);
	const botAhead2 = useSharedValue(false);
	const rank = useSharedValue(1);
	const elapsedMs = useSharedValue(0);
	const bestLead = useSharedValue(0);
	const warnAt = useSharedValue(-99999);
	const goT = useSharedValue(0);

	const onFinishedRef = useRef(onFinished);
	onFinishedRef.current = onFinished;
	const finishOnRN = useCallback((result: RaceResult) => {
		playGameSfx('fanfare');
		onFinishedRef.current(result);
	}, []);

	useFrameCallback(frameInfo => {
		'worklet';
		if (!running.value || ended.value) return;

		const dt = Math.max(1, Math.min(frameInfo.timeSincePreviousFrame ?? 16, T.MAX_FRAME_DT_MS));

		// --- Signal watch: pause (and freeze the whole race) on sustained loss ---
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

		if (goT.value > 0) goT.value = Math.max(0, goT.value - dt / T.GO_BANNER_MS);

		// The field waits at the start line until the calibration rep.
		if (!calibrated.value) return;

		elapsedMs.value += dt;

		// --- Player: energy decays, speed follows the tank ---
		energy.value = energyAfter(energy.value, dt);
		playerSpeed.value = speedForEnergy(energy.value);
		playerDist.value += (playerSpeed.value * dt) / 1000;

		// --- Bots: cruise + rubber band ---
		botSpeed0.value = botSpeed(P.BOT_BASE_MS[0], playerDist.value - botDist0.value);
		botSpeed1.value = botSpeed(P.BOT_BASE_MS[1], playerDist.value - botDist1.value);
		botSpeed2.value = botSpeed(P.BOT_BASE_MS[2], playerDist.value - botDist2.value);
		botDist0.value += (botSpeed0.value * dt) / 1000;
		botDist1.value += (botSpeed1.value * dt) / 1000;
		botDist2.value += (botSpeed2.value * dt) / 1000;

		// --- Overtakes: whoosh + haptic whenever anyone changes place ---
		const ahead0 = botDist0.value > playerDist.value;
		const ahead1 = botDist1.value > playerDist.value;
		const ahead2 = botDist2.value > playerDist.value;
		if (ahead0 !== botAhead0.value || ahead1 !== botAhead1.value || ahead2 !== botAhead2.value) {
			botAhead0.value = ahead0;
			botAhead1.value = ahead1;
			botAhead2.value = ahead2;
			scheduleOnRN(playGameSfx, 'overtake');
			scheduleOnRN(triggerHaptics, 'impactMedium');
		}
		rank.value = rankOf(playerDist.value, [botDist0.value, botDist1.value, botDist2.value]);

		// --- Lead bookkeeping + "bot on your heels" warning ---
		const nearestGap =
			playerDist.value - Math.max(botDist0.value, botDist1.value, botDist2.value);
		if (nearestGap > bestLead.value) bestLead.value = nearestGap;
		if (
			nearestGap > 0 &&
			nearestGap < P.WARN_GAP_M &&
			frameInfo.timestamp - warnAt.value > T.WARN_COOLDOWN_MS
		) {
			warnAt.value = frameInfo.timestamp;
			scheduleOnRN(playGameSfx, 'warning');
			scheduleOnRN(triggerHaptics, 'warning');
		}

		// --- Finish: the race ends when the athlete crosses the line ---
		if (playerDist.value >= P.RACE_LENGTH_M) {
			ended.value = true;
			scheduleOnRN(finishOnRN, {
				place: rank.value,
				timeMs: elapsedMs.value,
				distanceM: Math.round(playerDist.value),
				bestLeadM: Math.max(0, Math.round(bestLead.value)),
				finished: true,
			});
		}
	});

	const begin = useCallback(() => {
		signalLostAt.value = -1;
		paused.value = false;
		ended.value = false;
		playerDist.value = 0;
		playerSpeed.value = 0;
		energy.value = 0;
		botDist0.value = 0;
		botDist1.value = 0;
		botDist2.value = 0;
		botSpeed0.value = 0;
		botSpeed1.value = 0;
		botSpeed2.value = 0;
		botAhead0.value = false;
		botAhead1.value = false;
		botAhead2.value = false;
		rank.value = 1;
		elapsedMs.value = 0;
		bestLead.value = 0;
		warnAt.value = -99999;
		goT.value = 0;
		awaitingRep.value = true;
		calibrated.value = false;
		running.value = true;
	}, [
		signalLostAt, paused, ended, playerDist, playerSpeed, energy,
		botDist0, botDist1, botDist2, botSpeed0, botSpeed1, botSpeed2,
		botAhead0, botAhead1, botAhead2, rank, elapsedMs, bestLead, warnAt, goT,
		awaitingRep, calibrated, running,
	]);

	const rep = useCallback(() => {
		if (!running.value || ended.value || paused.value) return;

		// The calibration rep fires the starting pistol.
		if (awaitingRep.value) {
			awaitingRep.value = false;
			calibrated.value = true;
			goT.value = 1;
			playGameSfx('pistol');
			triggerHaptics('success');
			return;
		}

		energy.value = energyAfterRep(energy.value);
		playGameSfx('point');
		triggerHaptics('impactLight');
	}, [running, ended, paused, awaitingRep, calibrated, goT, energy]);

	const halt = useCallback(() => {
		running.value = false;
	}, [running]);

	return {
		running,
		awaitingRep,
		calibrated,
		paused,
		playerDist,
		playerSpeed,
		energy,
		botDist0,
		botDist1,
		botDist2,
		botSpeed0,
		botSpeed1,
		botSpeed2,
		rank,
		elapsedMs,
		bestLead,
		goT,
		begin,
		rep,
		halt,
	};
}
