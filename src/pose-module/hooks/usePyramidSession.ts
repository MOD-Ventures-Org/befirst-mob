import { useCallback, useEffect, useRef, useState } from 'react';

import { buildPyramidSequence, clampLevel, getTotalPyramidReps, PYRAMID_TIMING } from '../pyramid/pyramid';

import { usePoseSession } from './usePoseSession';

const T = PYRAMID_TIMING;
const TICK_MS = 100;

/**
 * Pyramid session phases (doc §6.5 state machine).
 * - SET_ACTIVE: counting reps for the current set.
 * - SET_DONE: brief hold showing the completed set's fully-filled ring.
 * - REST: 3·2·1 rest countdown between sets (just-completed set chip stays filled).
 * - GO: "Rep X Go!" grace window after rest, waiting for the first push-up.
 * - START_PROMPT: "Push Up or Quit" second chance after the GO window expires.
 * - REP_PROMPT: "Push Up or Quit" countdown after a long mid-set pause.
 * - CELEBRATE: final-set unlock moment (🎉 ring, apex highlight) held on video.
 * - COMPLETE / FAIL: terminal session outcomes.
 */
export type PyramidPhase =
	| 'READY'
	| 'SET_ACTIVE'
	| 'SET_DONE'
	| 'REST'
	| 'GO'
	| 'START_PROMPT'
	| 'REP_PROMPT'
	| 'CELEBRATE'
	| 'COMPLETE'
	| 'FAIL';

const ACTIVE_PHASES: PyramidPhase[] = ['SET_ACTIVE', 'SET_DONE', 'REST', 'GO', 'START_PROMPT', 'REP_PROMPT', 'CELEBRATE'];

export interface PyramidSessionState {
	phase: PyramidPhase;
	level: number;
	sequence: number[];
	totalReps: number;
	// Index into `sequence` of the current set.
	currentSetIndex: number;
	// Target reps for the current set.
	currentSetTarget: number;
	// Reps completed so far within the current set (starts at 0, doc §6.3).
	repsIntoSet: number;
	// Number of fully completed sets (drives the filled set chip).
	completedSetCount: number;
	// Visible countdown number for REST / prompt phases, else null.
	countdown: number | null;
	// Cumulative reps performed across the whole session.
	repCount: number;
	// Celebration beat during CELEBRATE (design frames): 0 = "N!", 1 = ✅, 2 = 🎉.
	celebrateStep: number;
}

/**
 * Orchestrates a Pyramid push-up session on top of the shared pose pipeline
 * (`usePoseSession`). The pose engine counts reps; this hook layers the pyramid
 * set sequence, rest countdowns, and the GO / grace prompt timing on top.
 *
 * Per-rep events feed the state machine through `usePoseSession`'s `onRep`
 * callback; a lightweight ticker drives the time-based transitions (rest,
 * grace windows, mid-set pause). Counting correctness is owned by the existing
 * engine and is intentionally out of scope for this POC.
 */
export function usePyramidSession() {
	const phaseRef = useRef<PyramidPhase>('READY');
	const [phase, setPhaseState] = useState<PyramidPhase>('READY');

	const sequenceRef = useRef<number[]>([]);
	const setIndexRef = useRef(0);
	const repsIntoSetRef = useRef(0);
	const completedSetCountRef = useRef(0);
	const phaseStartedAtRef = useRef(0);
	const lastRepAtRef = useRef(0);
	const totalRepsRef = useRef(0);

	const [level, setLevel] = useState(0);
	const [sequence, setSequence] = useState<number[]>([]);
	const [currentSetIndex, setCurrentSetIndex] = useState(0);
	const [repsIntoSet, setRepsIntoSet] = useState(0);
	const [completedSetCount, setCompletedSetCount] = useState(0);
	const [countdown, setCountdown] = useState<number | null>(null);
	const [repCount, setRepCount] = useState(0);
	const [celebrateStep, setCelebrateStep] = useState(0);

	const enterPhase = useCallback((next: PyramidPhase, now: number) => {
		phaseRef.current = next;
		phaseStartedAtRef.current = now;
		setPhaseState(next);
	}, []);

	const handleRepRef = useRef<() => void>(() => {});

	const { pose, signal, coachState, debugInfo, initError, solution, hasPermission, requestPermission, start, stop } =
		usePoseSession({
			exercise: 'pushup-pyramid',
			onRep: () => handleRepRef.current(),
		});

	const currentTarget = () => sequenceRef.current[setIndexRef.current] ?? 0;

	const finishSession = useCallback(
		(outcome: 'COMPLETE' | 'FAIL') => {
			stop();
			setCountdown(null);
			enterPhase(outcome, Date.now());
		},
		[enterPhase, stop],
	);

	// Promote the pending (rested) set to current: advance the index, reset the
	// in-set counter. Used both when the rest countdown ends and when the user
	// starts the next set early with a push-up.
	const promotePendingSet = useCallback((now: number) => {
		setIndexRef.current = completedSetCountRef.current;
		repsIntoSetRef.current = 0;
		lastRepAtRef.current = now;
		setCurrentSetIndex(setIndexRef.current);
		setRepsIntoSet(0);
	}, []);

	const completeCurrentSet = useCallback(
		(now: number) => {
			const completed = setIndexRef.current + 1;
			completedSetCountRef.current = completed;
			setCompletedSetCount(completed);

			if (completed >= sequenceRef.current.length) {
				// Final set: hold the celebration (🎉 ring + Level Unlocked) before the
				// success screen; the recording only finalizes on COMPLETE, so these
				// seconds end up in the shared video.
				stop();
				setCountdown(null);
				setCelebrateStep(0);
				enterPhase('CELEBRATE', now);
				return;
			}

			// Hold the fully-filled ring briefly, then rest. The just-completed chip
			// stays filled; the index advances only when the next set becomes current.
			enterPhase('SET_DONE', now);
		},
		[enterPhase, stop],
	);

	const countRep = useCallback(
		(now: number) => {
			repsIntoSetRef.current += 1;
			lastRepAtRef.current = now;
			setRepsIntoSet(repsIntoSetRef.current);
			if (repsIntoSetRef.current >= currentTarget()) {
				completeCurrentSet(now);
			}
		},
		[completeCurrentSet],
	);

	const handleRep = useCallback(() => {
		const current = phaseRef.current;
		if (current === 'READY' || current === 'CELEBRATE' || current === 'COMPLETE' || current === 'FAIL') return;

		const now = Date.now();
		totalRepsRef.current += 1;
		setRepCount(totalRepsRef.current);

		// A push-up during the set-done hold or rest starts the next set early
		// (doc §6.5 GO flow).
		if (current === 'REST' || current === 'SET_DONE') {
			promotePendingSet(now);
		}
		if (current !== 'SET_ACTIVE') {
			setCountdown(null);
			enterPhase('SET_ACTIVE', now);
		}
		countRep(now);
	}, [countRep, enterPhase, promotePendingSet]);
	handleRepRef.current = handleRep;

	const tick = useCallback(() => {
		const now = Date.now();
		const current = phaseRef.current;
		const elapsed = now - phaseStartedAtRef.current;

		if (current === 'SET_DONE') {
			if (elapsed >= T.SET_DONE_MS) {
				enterPhase('REST', now);
			}
			return;
		}

		if (current === 'CELEBRATE') {
			if (elapsed >= T.CELEBRATE_MS) {
				enterPhase('COMPLETE', now);
				return;
			}
			// Three design beats across the hold: "N!" → ✅ → 🎉.
			setCelebrateStep(Math.min(2, Math.floor(elapsed / (T.CELEBRATE_MS / 3))));
			return;
		}

		if (current === 'REST') {
			const remaining = T.REST_MS - elapsed;
			if (remaining <= 0) {
				promotePendingSet(now);
				setCountdown(null);
				enterPhase('GO', now);
				return;
			}
			// 3 shows for the first half second, then 2 and 1 for a second each.
			setCountdown(remaining > 2000 ? 3 : Math.max(1, Math.ceil(remaining / 1000)));
			return;
		}

		if (current === 'GO') {
			if (elapsed >= T.GO_GRACE_MS) {
				enterPhase('START_PROMPT', now);
			}
			return;
		}

		if (current === 'START_PROMPT') {
			const remaining = T.START_PROMPT_MS - elapsed;
			if (remaining <= 0) {
				finishSession('FAIL');
				return;
			}
			setCountdown(Math.max(1, Math.ceil(remaining / 1000)));
			return;
		}

		if (current === 'SET_ACTIVE') {
			const startedRepping = repsIntoSetRef.current >= 1;
			const moreRepsNeeded = repsIntoSetRef.current < currentTarget();
			if (currentTarget() > 1 && startedRepping && moreRepsNeeded && now - lastRepAtRef.current > T.REP_PAUSE_MS) {
				enterPhase('REP_PROMPT', now);
			}
			return;
		}

		if (current === 'REP_PROMPT') {
			const remaining = T.REP_PROMPT_MS - elapsed;
			if (remaining <= 0) {
				finishSession('FAIL');
				return;
			}
			setCountdown(Math.max(1, Math.ceil(remaining / 1000)));
		}
	}, [enterPhase, finishSession, promotePendingSet]);

	const isSessionActive = ACTIVE_PHASES.includes(phase);

	useEffect(() => {
		if (!isSessionActive) return;
		const id = setInterval(tick, TICK_MS);
		return () => clearInterval(id);
	}, [isSessionActive, tick]);

	const startSession = useCallback(
		(selectedLevel: number) => {
			const safeLevel = clampLevel(selectedLevel);
			const seq = buildPyramidSequence(safeLevel);
			const now = Date.now();

			sequenceRef.current = seq;
			setIndexRef.current = 0;
			repsIntoSetRef.current = 0;
			completedSetCountRef.current = 0;
			totalRepsRef.current = 0;
			lastRepAtRef.current = now;

			setLevel(safeLevel);
			setSequence(seq);
			setCurrentSetIndex(0);
			setRepsIntoSet(0);
			setCompletedSetCount(0);
			setCountdown(null);
			setRepCount(0);

			// First set begins immediately with "Rep 1 Go!" and no time limit (doc §5.4).
			enterPhase('SET_ACTIVE', now);
			start();
		},
		[enterPhase, start],
	);

	const resetSession = useCallback(() => {
		stop();
		phaseRef.current = 'READY';
		setPhaseState('READY');
		setCountdown(null);
	}, [stop]);

	const state: PyramidSessionState = {
		phase,
		level,
		sequence,
		totalReps: level ? getTotalPyramidReps(level) : 0,
		currentSetIndex,
		currentSetTarget: sequence[currentSetIndex] ?? 0,
		repsIntoSet,
		completedSetCount,
		countdown,
		repCount,
		celebrateStep,
	};

	return {
		...state,
		pose,
		signal,
		coachState,
		debugInfo,
		initError,
		solution,
		hasPermission,
		requestPermission,
		startSession,
		resetSession,
	};
}
