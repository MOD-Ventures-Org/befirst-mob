import { useCallback, useRef } from 'react';

import { type SharedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { playGameSfx } from '@/src/pose-module/audio/gameAudio';
import { triggerHaptics } from '@/src/services/haptics';

import type { PushUpSignal } from '../signal';

import { bossStatsForIndex } from './bosses';
import { damageForRep, isDodged, type KnockoutGeom, nextPopupSlot } from './combat';
import { KNOCKOUT_COMBAT, KNOCKOUT_TIMING } from './knockoutConfig';

const T = KNOCKOUT_TIMING;
const B = KNOCKOUT_COMBAT;

export const BOSS_PHASE = {
	ENTERING: 0,
	IDLE: 1,
	TELEGRAPH: 2,
	STRIKE: 3,
	DYING: 4,
} as const;

export interface KnockoutResult {
	score: number;
	bossesDefeated: number;
	maxCombo: number;
	knockedOut: boolean;
}

export interface KnockoutEngine {
	smoothedPos: SharedValue<number>;
	running: SharedValue<boolean>;
	/** True from Start until the calibration rep — boss waits, timers frozen. */
	awaitingRep: SharedValue<boolean>;
	calibrated: SharedValue<boolean>;
	paused: SharedValue<boolean>;
	bossIndex: SharedValue<number>;
	bossHp: SharedValue<number>;
	bossMaxHp: SharedValue<number>;
	bossPhase: SharedValue<number>;
	/** Milliseconds elapsed in the current boss phase (UI-thread clock). */
	phaseT: SharedValue<number>;
	hearts: SharedValue<number>;
	score: SharedValue<number>;
	bossesDefeated: SharedValue<number>;
	comboChain: SharedValue<number>;
	/** 1 → 0 remaining fraction of the combo window. */
	comboMeter: SharedValue<number>;
	maxCombo: SharedValue<number>;
	/** 1 → 0 hero punch lunge timeline. */
	punchT: SharedValue<number>;
	/** 1 → 0 impact star flash. */
	impactT: SharedValue<number>;
	/** 1 → 0 screen shake after taking a hit. */
	shakeT: SharedValue<number>;
	hitFlash: SharedValue<number>;
	/** 1 → 0 "DODGED!" beat. */
	dodgeT: SharedValue<number>;
	/** 1 → 0 "FIGHT!" banner after the calibration rep. */
	fightT: SharedValue<number>;
	popupVal0: SharedValue<number>;
	popupVal1: SharedValue<number>;
	popupVal2: SharedValue<number>;
	/** 0 → 1 popup lifetime progress; -1 = inactive. */
	popupT0: SharedValue<number>;
	popupT1: SharedValue<number>;
	popupT2: SharedValue<number>;
	geomSV: SharedValue<KnockoutGeom | null>;
	configure: (geom: KnockoutGeom) => void;
	begin: () => void;
	/** Call on every counted rep: first rep starts the fight, the rest punch. */
	punch: () => void;
	halt: () => void;
}

export interface UseKnockoutEngineConfig {
	signal: PushUpSignal;
	onFinished: (result: KnockoutResult) => void;
}

/**
 * The Push Knockout fight loop. Both input channels of the PushUpSignal are
 * used: counted reps land punches (discrete), and the continuous position
 * decides whether a telegraphed boss strike is dodged (the athlete must be
 * holding the bottom of the push-up at the strike moment). Every timer —
 * boss attack cycle, combo drain, animation beats — advances on the
 * UI-thread frame clock: the JS thread starves under camera + MediaPipe
 * load, so JS timers would stall the fight (field-learned on Flappy).
 */
export function useKnockoutEngine({ signal, onFinished }: UseKnockoutEngineConfig): KnockoutEngine {
	const smoothedPos = useSharedValue(1);
	const running = useSharedValue(false);
	const awaitingRep = useSharedValue(false);
	const calibrated = useSharedValue(false);
	const paused = useSharedValue(false);
	const ended = useSharedValue(false);
	const signalLostAt = useSharedValue(-1);

	const bossIndex = useSharedValue(0);
	const bossHp = useSharedValue(1);
	const bossMaxHp = useSharedValue(1);
	const bossPhase = useSharedValue<number>(BOSS_PHASE.IDLE);
	const phaseT = useSharedValue(0);
	const attackInterval = useSharedValue(5000);

	const hearts = useSharedValue<number>(B.MAX_HEARTS);
	const score = useSharedValue(0);
	const bossesDefeated = useSharedValue(0);
	const comboChain = useSharedValue(0);
	const comboMeter = useSharedValue(0);
	const maxCombo = useSharedValue(0);

	const punchT = useSharedValue(0);
	const impactT = useSharedValue(0);
	const shakeT = useSharedValue(0);
	const hitFlash = useSharedValue(0);
	const dodgeT = useSharedValue(0);
	const fightT = useSharedValue(0);

	const popupVal0 = useSharedValue(0);
	const popupVal1 = useSharedValue(0);
	const popupVal2 = useSharedValue(0);
	const popupT0 = useSharedValue(-1);
	const popupT1 = useSharedValue(-1);
	const popupT2 = useSharedValue(-1);
	const popupSlot = useSharedValue(-1);

	const geomSV = useSharedValue<KnockoutGeom | null>(null);

	const onFinishedRef = useRef(onFinished);
	onFinishedRef.current = onFinished;
	const finishOnRN = useCallback((result: KnockoutResult) => {
		playGameSfx('fanfare');
		onFinishedRef.current(result);
	}, []);

	useFrameCallback(frameInfo => {
		'worklet';
		if (!running.value || ended.value) return;

		// Clamp BOTH ends: a 0 ms delta breaks rate math, a hitched frame must
		// not fast-forward the boss cycle (same discipline as Flappy).
		const dt = Math.max(1, Math.min(frameInfo.timeSincePreviousFrame ?? 16, T.MAX_FRAME_DT_MS));

		// --- Signal watch: pause (and freeze every timer) on sustained loss ---
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

		const alpha = 1 - Math.exp(-dt / T.EMA_TAU_MS);
		smoothedPos.value += alpha * (signal.position.value - smoothedPos.value);

		// --- Animation beats decay every frame ---
		if (punchT.value > 0) punchT.value = Math.max(0, punchT.value - dt / T.PUNCH_MS);
		if (impactT.value > 0) impactT.value = Math.max(0, impactT.value - dt / T.IMPACT_MS);
		if (shakeT.value > 0) shakeT.value = Math.max(0, shakeT.value - dt / T.SHAKE_MS);
		if (hitFlash.value > 0) hitFlash.value = Math.max(0, hitFlash.value - dt / T.HIT_FLASH_MS);
		if (dodgeT.value > 0) dodgeT.value = Math.max(0, dodgeT.value - dt / T.DODGE_MS);
		if (fightT.value > 0) fightT.value = Math.max(0, fightT.value - dt / T.FIGHT_BANNER_MS);
		if (popupT0.value >= 0 && popupT0.value < 1) popupT0.value = Math.min(1, popupT0.value + dt / T.POPUP_MS);
		if (popupT1.value >= 0 && popupT1.value < 1) popupT1.value = Math.min(1, popupT1.value + dt / T.POPUP_MS);
		if (popupT2.value >= 0 && popupT2.value < 1) popupT2.value = Math.min(1, popupT2.value + dt / T.POPUP_MS);

		// The boss waits (no attacks, no combo drain) until the calibration rep.
		if (!calibrated.value) return;

		// --- Combo window drain ---
		if (comboChain.value > 0) {
			comboMeter.value = Math.max(0, comboMeter.value - dt / T.COMBO_WINDOW_MS);
			if (comboMeter.value === 0) comboChain.value = 0;
		}

		// --- Boss phase machine ---
		phaseT.value += dt;
		const p = bossPhase.value;
		if (p === BOSS_PHASE.ENTERING && phaseT.value >= T.ENTER_MS) {
			bossPhase.value = BOSS_PHASE.IDLE;
			phaseT.value = 0;
		} else if (p === BOSS_PHASE.IDLE && phaseT.value >= attackInterval.value) {
			bossPhase.value = BOSS_PHASE.TELEGRAPH;
			phaseT.value = 0;
			scheduleOnRN(playGameSfx, 'warning');
			scheduleOnRN(triggerHaptics, 'warning');
		} else if (p === BOSS_PHASE.TELEGRAPH && phaseT.value >= T.TELEGRAPH_MS) {
			// Strike lands NOW — a bottom hold dodges it.
			bossPhase.value = BOSS_PHASE.STRIKE;
			phaseT.value = 0;
			if (isDodged(smoothedPos.value)) {
				dodgeT.value = 1;
				score.value += B.DODGE_BONUS;
				scheduleOnRN(playGameSfx, 'dodge');
				scheduleOnRN(triggerHaptics, 'impactLight');
			} else {
				hearts.value -= 1;
				shakeT.value = 1;
				hitFlash.value = 1;
				scheduleOnRN(playGameSfx, 'hit');
				scheduleOnRN(triggerHaptics, 'error');
				if (hearts.value <= 0) {
					ended.value = true;
					scheduleOnRN(finishOnRN, {
						score: score.value,
						bossesDefeated: bossesDefeated.value,
						maxCombo: maxCombo.value,
						knockedOut: true,
					});
					return;
				}
			}
		} else if (p === BOSS_PHASE.STRIKE && phaseT.value >= T.STRIKE_MS) {
			bossPhase.value = BOSS_PHASE.IDLE;
			phaseT.value = 0;
		} else if (p === BOSS_PHASE.DYING && phaseT.value >= T.DYING_MS) {
			const next = bossIndex.value + 1;
			const stats = bossStatsForIndex(next);
			bossIndex.value = next;
			bossHp.value = stats.maxHp;
			bossMaxHp.value = stats.maxHp;
			attackInterval.value = stats.attackIntervalMs;
			bossPhase.value = BOSS_PHASE.ENTERING;
			phaseT.value = 0;
		}
	});

	const configure = useCallback(
		(geom: KnockoutGeom) => {
			geomSV.value = geom;
		},
		[geomSV],
	);

	const begin = useCallback(() => {
		const stats = bossStatsForIndex(0);
		smoothedPos.value = 1;
		signalLostAt.value = -1;
		paused.value = false;
		ended.value = false;
		bossIndex.value = 0;
		bossHp.value = stats.maxHp;
		bossMaxHp.value = stats.maxHp;
		attackInterval.value = stats.attackIntervalMs;
		bossPhase.value = BOSS_PHASE.IDLE;
		phaseT.value = 0;
		hearts.value = B.MAX_HEARTS;
		score.value = 0;
		bossesDefeated.value = 0;
		comboChain.value = 0;
		comboMeter.value = 0;
		maxCombo.value = 0;
		punchT.value = 0;
		impactT.value = 0;
		shakeT.value = 0;
		hitFlash.value = 0;
		dodgeT.value = 0;
		fightT.value = 0;
		popupT0.value = -1;
		popupT1.value = -1;
		popupT2.value = -1;
		popupSlot.value = -1;
		awaitingRep.value = true;
		calibrated.value = false;
		running.value = true;
	}, [
		smoothedPos, signalLostAt, paused, ended, bossIndex, bossHp, bossMaxHp, attackInterval,
		bossPhase, phaseT, hearts, score, bossesDefeated, comboChain, comboMeter, maxCombo,
		punchT, impactT, shakeT, hitFlash, dodgeT, fightT, popupT0, popupT1, popupT2, popupSlot,
		awaitingRep, calibrated, running,
	]);

	const punch = useCallback(() => {
		if (!running.value || ended.value || paused.value) return;

		// The calibration rep opens the fight; it doesn't hit the boss.
		if (awaitingRep.value) {
			awaitingRep.value = false;
			calibrated.value = true;
			fightT.value = 1;
			phaseT.value = 0;
			playGameSfx('go');
			triggerHaptics('success');
			return;
		}

		comboChain.value += 1;
		comboMeter.value = 1;
		if (comboChain.value > maxCombo.value) maxCombo.value = comboChain.value;
		punchT.value = 1;

		// Punches only damage a living boss; during death/entry they still
		// keep the combo alive so a fast pace is never punished.
		const p = bossPhase.value;
		if (p === BOSS_PHASE.DYING || p === BOSS_PHASE.ENTERING) return;

		const dmg = damageForRep(comboChain.value);
		bossHp.value = Math.max(0, bossHp.value - dmg);
		score.value += dmg;
		impactT.value = 1;

		const slot = nextPopupSlot(popupSlot.value);
		popupSlot.value = slot;
		if (slot === 0) {
			popupVal0.value = dmg;
			popupT0.value = 0;
		} else if (slot === 1) {
			popupVal1.value = dmg;
			popupT1.value = 0;
		} else {
			popupVal2.value = dmg;
			popupT2.value = 0;
		}

		playGameSfx('punch');
		triggerHaptics('impactLight');

		if (bossHp.value === 0) {
			bossesDefeated.value += 1;
			score.value += B.BOSS_DEFEAT_BONUS;
			bossPhase.value = BOSS_PHASE.DYING;
			phaseT.value = 0;
			playGameSfx('ko');
			triggerHaptics('success');
		}
	}, [
		running, ended, paused, awaitingRep, calibrated, fightT, phaseT, comboChain, comboMeter,
		maxCombo, punchT, bossPhase, bossHp, score, impactT, popupSlot,
		popupVal0, popupVal1, popupVal2, popupT0, popupT1, popupT2, bossesDefeated,
	]);

	const halt = useCallback(() => {
		running.value = false;
	}, [running]);

	return {
		smoothedPos,
		running,
		awaitingRep,
		calibrated,
		paused,
		bossIndex,
		bossHp,
		bossMaxHp,
		bossPhase,
		phaseT,
		hearts,
		score,
		bossesDefeated,
		comboChain,
		comboMeter,
		maxCombo,
		punchT,
		impactT,
		shakeT,
		hitFlash,
		dodgeT,
		fightT,
		popupVal0,
		popupVal1,
		popupVal2,
		popupT0,
		popupT1,
		popupT2,
		geomSV,
		configure,
		begin,
		punch,
		halt,
	};
}
