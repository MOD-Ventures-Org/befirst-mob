import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { DetectionError, PoseDetectionResultBundle, ViewCoordinator } from 'react-native-mediapipe';
import { type SharedValue, useSharedValue } from 'react-native-reanimated';

import { getExerciseConfig } from '../exercises';
import { PUSHUP_PARAMS } from '../exercises/pushup.config';
import { SQUAT_PARAMS } from '../exercises/squat.config';
import { CounterTraceRecorder } from '../counterTrace';
import type { PushUpSignal } from '../games/signal';
import { computeGateDiagnostics } from '../gateDiagnostics';
import { bodyExtension, worldArmExtension } from '../geometry';
import { SkeletonOneEuro } from '../oneEuro';
import { addPerfSample, createPerfSampleBuffer, createPerfSnapshot, resetPerfSampleBuffer } from '../perfMetrics';
import { displayTier, shouldersPresent, tooClose } from '../plausibility';
import { PoseStabilizer } from '../poseStabilizer';
import { isUprightExtended } from '../posture';
import { RepDetector } from '../repDetector';
import { computeAngles } from '../services/AngleCalculator';
import { useCameraService } from '../services/CameraService';
import { FormChecker } from '../services/FormChecker';
import { toSkeleton } from '../services/PoseDetector';
import { VelocityTracker } from '../services/VelocityTracker';
import { buildRenderPose } from '../skeleton';
import {
	BandedSideStepDetector,
	type BandedSideStepTrackingState,
	type BandedSideStepUpdate,
} from '../side-steps/BandedSideStepDetector';
import { SquatDetector, type SquatTrackingState, type SquatUpdate } from '../squats/SquatDetector';
import { measureSquat } from '../squats/squatMetrics';
import { StateMachine } from '../state-machine/StateMachine';
import { SubjectLock } from '../subjectLock';
import type { CoachState, DebugInfo, FormViolation, PoseSession, RenderPose, RepResult } from '../types';

import {
	ANDROID_PROFILE_EVALUATION_INTERVAL_FRAMES,
	getPoseInferenceFps,
	resolveAndroidPerformanceTier,
	shouldDowngradeAndroidProfile,
	type AndroidPerformanceTier,
} from '../performanceProfile';

import { useFrameRate } from './useFrameRate';

const P = PUSHUP_PARAMS;

// Keep the last pose on screen across brief detection dropouts to avoid flicker.
const MAX_MISSING_FRAMES = 5;
// Debounce coaching messages so brief dropouts don't flash text (spec §10).
const COACH_HOLD_FRAMES = 6;
// Push debug telemetry to React state at ~6-7Hz, not per frame, so the debug
// overlay does not add a per-frame re-render to the pose hot path.
const DEBUG_THROTTLE_MS = 150;
// Coach text is secondary to camera/pose work. State is kept current in refs,
// while React receives no more than four updates per second.
const COACH_UI_THROTTLE_MS = 250;
// The live hold clock needs to feel responsive, without pushing camera-frame
// updates through React.
const SQUAT_UI_THROTTLE_MS = 100;

// The five lines that must stay on screen while counting: shoulder bridge +
// both upper arms + both forearms → these six joints.
const FIVE_LINES_JOINTS = ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist'] as const;

export interface UsePoseSessionConfig {
	exercise: string;
	targetReps?: number;
	// Stores a short, in-memory trace of counter decisions for device testing.
	// It defaults off and never writes camera or landmark data to disk.
	debugTrace?: boolean;
	onComplete?: (session: PoseSession) => void;
	// Fired once per newly counted rep (discrete event, not a cumulative count).
	// Used by the Pyramid mode to drive its set / rest / grace state machine; the
	// detector's own count can reset when the body leaves plank between sets, so
	// callers must treat each call as a single +1 rep rather than an absolute.
	onRep?: () => void;
}

function buildPoseSession(exercise: string, startedAt: number, reps: RepResult[]): PoseSession {
	const totalReps = reps.length;
	const validReps = reps.filter(r => r.isValid).length;
	const avgFormScore = totalReps > 0 ? Math.round(reps.reduce((s, r) => s + r.formScore, 0) / totalReps) : 0;

	const errorFreq: Record<string, number> = {};
	const errorByCode: Record<string, FormViolation> = {};

	for (const rep of reps) {
		for (const v of rep.violations) {
			errorByCode[v.code] = v;
			errorFreq[v.code] = (errorFreq[v.code] ?? 0) + 1;
		}
	}

	const commonErrors = Object.entries(errorFreq)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 3)
		.map(([code]) => errorByCode[code]);

	return {
		exercise,
		duration: (Date.now() - startedAt) / 1000,
		completedAt: new Date(),
		reps,
		summary: { totalReps, validReps, avgFormScore, commonErrors },
	};
}

/**
 * Main hook for the push-up trainer. Runs the per-frame pipeline:
 * landmarks -> subject lock -> One Euro smoothing -> display tier +
 * plausibility -> render stabilizer -> session gate -> rep counting + form
 * checking. The drawn pose is written to a Reanimated shared value (read by
 * the Skia overlay on the UI thread); only discrete values (rep count,
 * coaching state) cross to React state.
 *
 * There is no readiness gate: counting starts with the first push-up. The only
 * per-frame guard is the upright veto (isUprightExtended) so walking/standing
 * motion never counts. RepDetector's depth-oscillation envelope drives the
 * visible rep count (robust to elbow occlusion at the bottom of a rep);
 * StateMachine + FormChecker run in parallel for phase display and per-rep
 * form scores.
 */
export function usePoseSession({ exercise, targetReps, onComplete, onRep, debugTrace = false }: UsePoseSessionConfig) {
	const isSquat = exercise === 'squat';
	const isJumpSquat = exercise === 'jump-squat';
	const isSquatExercise = isSquat || isJumpSquat;
	const isBandedSideStep = exercise === 'banded-side-step';
	const isLowerBodyExercise = isSquatExercise || isBandedSideStep;
	const exerciseConfig = useRef(getExerciseConfig(exercise));

	const oneEuro = useRef(new SkeletonOneEuro());
	const stabilizer = useRef(new PoseStabilizer());
	const repDetector = useRef(new RepDetector());
	const squatDetector = useRef(new SquatDetector(isJumpSquat ? 'jump' : 'standard'));
	const sideStepDetector = useRef(new BandedSideStepDetector());
	const subjectLock = useRef(new SubjectLock());
	const velocityTracker = useRef(new VelocityTracker(0.4));
	const stateMachine = useRef(new StateMachine(exerciseConfig.current));
	const formChecker = useRef(new FormChecker(exerciseConfig.current));
	const repHistory = useRef<RepResult[]>([]);
	const sessionStartedAt = useRef(0);
	const missingFrames = useRef(0);

	// Per-frame perf sampling stays in refs; avg/p95 are computed only on the
	// debug throttle tick.
	const inferenceSamples = useRef(createPerfSampleBuffer());
	const processedFrames = useRef(0);

	// Depth-signal state (all in refs — off the render path).
	const lastDepth = useRef<number | null>(null);
	const lastPosition = useRef<number | null>(null);
	const depthHoldFrames = useRef(0);
	const lastBodyMs = useRef(0);
	// The counter state is allowed to survive a short confidence dip. A raw
	// camera frame can lose an ankle/wrist during a jump even while the next
	// frame immediately recovers it; that must not restart the exercise.
	const lastLowerBodyTrackedMs = useRef(0);
	const counterTrace = useRef(new CounterTraceRecorder());
	counterTrace.current.setEnabled(debugTrace);
	const armedAtMs = useRef(0);
	// Last time all five upper-body lines were confidently tracked.
	const lastLinesOkMs = useRef(0);

	const pose = useSharedValue<RenderPose | null>(null);

	// PushUpSignal contract for the mini-games (see games/signal.ts). Written
	// per processed frame on the same callback thread as `pose`.
	const signalPosition = useSharedValue(1);
	const signalConfidence = useSharedValue(0);
	const signalPersonDetected = useSharedValue(false);
	const signalPalmsPlanted = useSharedValue(true);

	const [repCount, setRepCount] = useState(0);
	const [squatTracking, setSquatTracking] = useState<SquatTrackingState>(() => squatDetector.current.snapshot(0));
	const [sideStepTracking, setSideStepTracking] = useState<BandedSideStepTrackingState>(() =>
		sideStepDetector.current.snapshot(0),
	);
	const [coachState, setCoachState] = useState<CoachState>('NO_BODY');
	const [isRunning, setIsRunning] = useState(false);
	const [androidPerformanceTier, setAndroidPerformanceTier] = useState<AndroidPerformanceTier>('high');
	const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
	const [trackingDetail, setTrackingDetail] = useState('');
	// Surfaces a failed pose-landmarker init (e.g. delegate/model load failure)
	// so the screen can show an actual error instead of silently sitting on a
	// frozen skeleton/rep count forever — this previously only reached
	// `console.error`, invisible in a release build.
	const [initError, setInitError] = useState<string | null>(null);
	const lastDebugMs = useRef(0);
	const performanceTierRef = useRef<AndroidPerformanceTier>('high');
	const processingFps = getPoseInferenceFps(androidPerformanceTier, isRunning);
	const processingFpsRef = useRef(processingFps);
	processingFpsRef.current = processingFps;

	const isRunningRef = useRef(false);
	const repCountRef = useRef(0);
	const onCompleteRef = useRef(onComplete);
	onCompleteRef.current = onComplete;
	const onRepRef = useRef(onRep);
	onRepRef.current = onRep;
	const targetRepsRef = useRef(targetReps);
	targetRepsRef.current = targetReps;

	// Coaching debounce state.
	const coachRef = useRef<CoachState>('NO_BODY');
	const coachCandidate = useRef<CoachState>('NO_BODY');
	const coachHold = useRef(0);
	const renderedCoachRef = useRef<CoachState>('NO_BODY');
	const lastCoachUiUpdateMs = useRef(0);
	const lastSquatUiUpdateMs = useRef(0);
	const trackingDetailRef = useRef('');

	const { measure } = useFrameRate();

	const commitCoach = useCallback((next: CoachState, now: number) => {
		const publishCoach = () => {
			if (renderedCoachRef.current === coachRef.current || now - lastCoachUiUpdateMs.current < COACH_UI_THROTTLE_MS) {
				return;
			}
			renderedCoachRef.current = coachRef.current;
			lastCoachUiUpdateMs.current = now;
			setCoachState(coachRef.current);
		};

		if (next === coachRef.current) {
			coachHold.current = 0;
			publishCoach();
			return;
		}
		if (next === coachCandidate.current) {
			coachHold.current += 1;
			if (coachHold.current >= COACH_HOLD_FRAMES) {
				coachRef.current = next;
				coachHold.current = 0;
				publishCoach();
			}
		} else {
			coachCandidate.current = next;
			coachHold.current = 1;
		}
	}, []);

	// Unlike pose data, this string only changes on a detector-state transition
	// or a genuine tracking problem, so it stays off the camera-frame render
	// path while still explaining why a counter is not advancing.
	const commitTrackingDetail = useCallback((next: string) => {
		if (next === trackingDetailRef.current) return;
		trackingDetailRef.current = next;
		setTrackingDetail(next);
	}, []);

	const publishSquatTracking = useCallback((update: SquatUpdate, now: number) => {
		const shouldPublish =
			update.rep !== undefined ||
			update.completedHold !== undefined ||
			now - lastSquatUiUpdateMs.current >= SQUAT_UI_THROTTLE_MS;
		if (!shouldPublish) return;
		lastSquatUiUpdateMs.current = now;
		setSquatTracking({
			repCounts: update.repCounts,
			totalReps: update.totalReps,
			activeVariant: update.activeVariant,
			activeHold: update.activeHold,
			holds: update.holds,
			status: update.status,
		});
	}, []);

	const publishSideStepTracking = useCallback((update: BandedSideStepUpdate, now: number) => {
		const shouldPublish =
			update.step !== undefined ||
			update.completedHold !== undefined ||
			now - lastSquatUiUpdateMs.current >= SQUAT_UI_THROTTLE_MS;
		if (!shouldPublish) return;
		lastSquatUiUpdateMs.current = now;
		setSideStepTracking({
			leftSteps: update.leftSteps,
			rightSteps: update.rightSteps,
			totalSteps: update.totalSteps,
			activeDirection: update.activeDirection,
			activeHold: update.activeHold,
			holds: update.holds,
			status: update.status,
		});
	}, []);

	const stop = useCallback(() => {
		if (!isRunningRef.current) return;
		if (isSquatExercise) {
			const now = Date.now();
			publishSquatTracking(squatDetector.current.finish(now), now);
		} else if (isBandedSideStep) {
			const now = Date.now();
			publishSideStepTracking(sideStepDetector.current.finish(now), now);
		}
		isRunningRef.current = false;
		setIsRunning(false);
		onCompleteRef.current?.(buildPoseSession(exercise, sessionStartedAt.current, repHistory.current));
	}, [exercise, isBandedSideStep, isSquatExercise, publishSideStepTracking, publishSquatTracking]);

	// Clears the depth envelope only — the rep count survives (mid-set rest,
	// brief body loss). Full counter reset happens in start().
	const resetDepthState = useCallback(() => {
		repDetector.current.resetSignal();
		lastDepth.current = null;
		lastPosition.current = null;
		depthHoldFrames.current = 0;
		lastBodyMs.current = 0;
	}, []);

	const start = useCallback(() => {
		oneEuro.current.reset();
		stabilizer.current.reset();
		stateMachine.current.resetSession();
		velocityTracker.current.reset();
		repDetector.current.reset();
		squatDetector.current.reset();
		sideStepDetector.current.reset();
		subjectLock.current.reset();
		// No readiness gate — the session is live immediately; GO shows briefly.
		armedAtMs.current = Date.now();
		lastLinesOkMs.current = 0;
		lastLowerBodyTrackedMs.current = 0;
		resetPerfSampleBuffer(inferenceSamples.current);
		processedFrames.current = 0;
		resetDepthState();
		repHistory.current = [];
		sessionStartedAt.current = Date.now();
		repCountRef.current = 0;
		lastSquatUiUpdateMs.current = 0;
		counterTrace.current.reset();
		setRepCount(0);
		setSquatTracking(squatDetector.current.snapshot(0));
		setSideStepTracking(sideStepDetector.current.snapshot(0));
		commitTrackingDetail('');
		isRunningRef.current = true;
		setIsRunning(true);
	}, [commitTrackingDetail, resetDepthState]);

	const onResults = useCallback(
		(results: PoseDetectionResultBundle, vc: ViewCoordinator) => {
			const fps = measure();
			addPerfSample(inferenceSamples.current, results.inferenceTime);
			processedFrames.current += 1;
			if (
				Platform.OS === 'android' &&
				processedFrames.current % ANDROID_PROFILE_EVALUATION_INTERVAL_FRAMES === 0
			) {
				const performance = createPerfSnapshot(
					inferenceSamples.current,
					fps,
					processedFrames.current,
					processingFpsRef.current,
				);
				const nextTier = resolveAndroidPerformanceTier(performance);
				if (shouldDowngradeAndroidProfile(performanceTierRef.current, nextTier)) {
					performanceTierRef.current = nextTier;
					setAndroidPerformanceTier(nextTier);
				}
			}

			const frame = toSkeleton(results, vc);
			const now = Date.now();

			// Primary-subject lock: a confident detection that teleports or
			// rescales versus the locked subject is a background shape — treat the
			// frame exactly like a detection dropout. Judged on the RAW skeleton,
			// before smoothing can soften the jump.
			const isSubject = frame !== null && subjectLock.current.update(frame.skeleton, frame.visibility, now);

			if (!frame || !isSubject) {
				missingFrames.current += 1;
				signalPersonDetected.value = false;
				signalConfidence.value = 0;
				signalPalmsPlanted.value = true;
				// The stabilizer owns disappearance: hold-last-known, then fade. A
				// hard reset here was the old "skeleton blinks off" path.
				pose.value = stabilizer.current.update({ tier: 'NO_BODY', pts: [] }, false, now);
				if (missingFrames.current > MAX_MISSING_FRAMES) {
					oneEuro.current.reset();
					velocityTracker.current.reset();
					resetDepthState();
					if (isSquatExercise) {
						publishSquatTracking(squatDetector.current.pause(now), now);
					} else if (isBandedSideStep) {
						publishSideStepTracking(sideStepDetector.current.pause(now), now);
					}
					commitTrackingDetail('Tracking lost — return your full body to the frame');
					// Body loss never resets the session — ask the athlete back
					// instead of showing the pre-start copy.
					commitCoach(isRunningRef.current ? 'STAND_FACING_CAMERA' : 'NO_BODY', now);
				}
				if (P.DEBUG_HUD && isRunningRef.current && now - lastDebugMs.current >= DEBUG_THROTTLE_MS) {
					lastDebugMs.current = now;
					setDebugInfo({
						fps,
						inferenceMs: results.inferenceTime,
						landmarksDetected: false,
						coach: coachRef.current,
						tier: 'NO_BODY',
						missingFrames: missingFrames.current,
						repCount: repCountRef.current,
						perf: createPerfSnapshot(inferenceSamples.current, fps, processedFrames.current, processingFpsRef.current),
					});
				}
				return;
			}
			missingFrames.current = 0;
			const visValues = Object.values(frame.visibility);
			const meanConf =
				visValues.length > 0 ? visValues.reduce((sum, value) => sum + value, 0) / visValues.length : 0;
			signalPersonDetected.value = true;
			signalConfidence.value = meanConf;

			const smoothed = oneEuro.current.filter(frame.skeleton, now);
			const smoothedFrame = {
				skeleton: smoothed,
				normalized: frame.normalized,
				visibility: frame.visibility,
			};

			const tier = displayTier(smoothedFrame);
			const rawPose = buildRenderPose(smoothed, frame.normalized, frame.visibility, tier);
			// Temporal hysteresis: sticky lines, rate-limited alpha, no flying joints.
			pose.value = stabilizer.current.update(rawPose, tier !== 'NO_BODY', now);
			// Rendering uses the One Euro-filtered skeleton. Exercise metrics must
			// use raw landmarks: visual smoothing otherwise delays and flattens the
			// exact high-velocity portion of a jump or side step.
			const squatMetrics = isLowerBodyExercise ? measureSquat(frame.skeleton, frame.visibility) : null;
			if (squatMetrics) lastLowerBodyTrackedMs.current = now;

			// --- Push-up signal: world-space arm extension first, 2-D fallback ---
			// The old counter measured only screen Y. From a front/floor camera the
			// chest commonly moves along camera depth, so the signal was flat despite
			// a real rep. MediaPipe already supplies world landmarks; use their 3-D
			// shoulder→wrist distance, preserving the old 2-D signal for old bridges.
			const imageDepth = bodyExtension(frame.skeleton, frame.visibility);
			let depth = worldArmExtension(frame.world, frame.visibility) ?? imageDepth;
			if (depth === null) {
				if (lastDepth.current !== null && depthHoldFrames.current < P.DEPTH_HOLD_FRAMES) {
					depth = lastDepth.current;
					depthHoldFrames.current += 1;
				}
			} else {
				lastDepth.current = depth;
				depthHoldFrames.current = 0;
			}

			const pushupCanCount = !isUprightExtended(frame.skeleton, frame.visibility);
			// A valid world-space arm signal and a non-upright body prove that the
			// athlete is in the exercise. This intentionally does not depend on the
			// old screen-Y hand gap, which is view-angle dependent.
			const plankish = depth !== null && pushupCanCount;
			if (plankish) {
				lastBodyMs.current = now;
			} else if (now - lastBodyMs.current > P.LOST_TIMEOUT_MS) {
				resetDepthState();
			}

			if (isRunningRef.current) {
				if (isSquatExercise) {
					signalPalmsPlanted.value = true;
					const squatUpdate = squatMetrics
						? squatDetector.current.update(squatMetrics, now)
						: now - lastLowerBodyTrackedMs.current <= SQUAT_PARAMS.TRACKING_GAP_MS
							? squatDetector.current.gap(now)
							: squatDetector.current.pause(now);
					publishSquatTracking(squatUpdate, now);
					commitTrackingDetail(squatUpdate.status);
					counterTrace.current.record({
						atMs: now,
						exercise,
						state: squatUpdate.activeVariant ?? 'tracking',
						reason: squatUpdate.status,
						signal: squatMetrics?.kneeAngle ?? null,
						trackingAgeMs: Math.max(0, now - lastLowerBodyTrackedMs.current),
					});

					if (squatUpdate.rep) {
						repCountRef.current = squatUpdate.totalReps;
						setRepCount(squatUpdate.totalReps);
						repHistory.current.push({
							repNumber: squatUpdate.totalReps,
							isValid: true,
							formScore: 100,
							violations: [],
						});
						onRepRef.current?.();
						if (targetRepsRef.current && squatUpdate.totalReps >= targetRepsRef.current) {
							stop();
						}
					}
				} else if (isBandedSideStep) {
					signalPalmsPlanted.value = true;
					const sideStepUpdate = squatMetrics
						? sideStepDetector.current.update(squatMetrics, now)
						: now - lastLowerBodyTrackedMs.current <= SQUAT_PARAMS.TRACKING_GAP_MS
							? sideStepDetector.current.gap(now)
							: sideStepDetector.current.pause(now);
					publishSideStepTracking(sideStepUpdate, now);
					commitTrackingDetail(sideStepUpdate.status);
					counterTrace.current.record({
						atMs: now,
						exercise,
						state: sideStepUpdate.activeDirection ?? 'tracking',
						reason: sideStepUpdate.status,
						signal: squatMetrics?.kneeAngle ?? null,
						trackingAgeMs: Math.max(0, now - lastLowerBodyTrackedMs.current),
					});

					if (sideStepUpdate.step) {
						repCountRef.current = sideStepUpdate.totalSteps;
						setRepCount(sideStepUpdate.totalSteps);
						repHistory.current.push({
							repNumber: sideStepUpdate.totalSteps,
							isValid: true,
							formScore: 100,
							violations: [],
						});
						onRepRef.current?.();
						if (targetRepsRef.current && sideStepUpdate.totalSteps >= targetRepsRef.current) {
							stop();
						}
					}
				} else {
				const angles = computeAngles(smoothed);
				const velocities = velocityTracker.current.update(frame.skeleton, now);

				// The only counting guard: the view-independent "stood up" signal —
				// torso angle is unusable with the floor camera facing the athlete
				// (see isUprightExtended). In plank it is false, so the first
				// push-up counts immediately.
				const canCount = pushupCanCount;

				const currentPhase = stateMachine.current.getPhase();
				const formResult = formChecker.current.evaluate(currentPhase, angles, smoothed);

				// Hands-planted veto: crawling/walking toward the phone swings the
				// depth signal exactly like reps, but in a push-up the wrists stay
				// planted — while they travel, wipe the oscillation envelope. The
				// rep count itself is never touched.
				const wristsTraveling =
					velocities !== null &&
					Math.max(Math.abs(velocities.leftWrist), Math.abs(velocities.rightWrist)) > P.HANDS_TRAVEL_MAX_SW_S;
				signalPalmsPlanted.value = !wristsTraveling;

				if (P.DEBUG_HUD && now - lastDebugMs.current >= DEBUG_THROTTLE_MS) {
					lastDebugMs.current = now;
					setDebugInfo({
						fps,
						inferenceMs: results.inferenceTime,
						landmarksDetected: true,
						conf: meanConf,
						minConf: visValues.length > 0 ? Math.min(...visValues) : 0,
						coach: coachRef.current,
						tier,
						depth,
						position: lastPosition.current,
						plankish,
						counting: canCount,
						missingFrames: missingFrames.current,
						angles,
						velocities: velocities ?? undefined,
						phase: currentPhase,
						repCount: repCountRef.current,
						gateChecks: computeGateDiagnostics(smoothedFrame, angles, { plankish, depth, wristsTraveling }),
						counter: {
							exercise: 'pushup',
							state: currentPhase,
							reason: !canCount
								? 'Get into push-up position'
								: depth === null
									? 'Keep shoulders and at least one wrist visible'
									: wristsTraveling
										? 'Keep hands planted'
										: 'Tracking arm extension',
							signal: depth,
						},
						perf: createPerfSnapshot(inferenceSamples.current, fps, processedFrames.current, processingFpsRef.current),
					});
				}

				if (canCount) {
					commitTrackingDetail(
						depth === null
							? 'Keep shoulders and at least one wrist visible'
							: wristsTraveling
								? 'Keep hands planted'
								: 'Tracking arm extension',
					);
					counterTrace.current.record({
						atMs: now,
						exercise,
						state: currentPhase,
						reason:
							depth === null
								? 'Keep shoulders and at least one wrist visible'
								: wristsTraveling
									? 'Keep hands planted'
									: 'Tracking arm extension',
						signal: depth,
					});

					// RepDetector drives the rep count (shoulder-height oscillation is
					// the rep signal; survives elbow occlusion at the bottom).
					if (wristsTraveling) {
						repDetector.current.resetSignal();
					} else if (depth !== null) {
						// Games' position signal shares the counting vetoes: feeding it
						// while upright or walking calibrates the envelope to noise and
						// pins the game sprite to the wrong end (field bug). It holds
						// its last value whenever the vetoes are active.
						const position = repDetector.current.observeDepth(depth);
						if (position !== null) {
							signalPosition.value = position;
							lastPosition.current = position;
						}
						const rep = repDetector.current.update(depth, now);
						if (rep.repCount !== repCountRef.current) {
							repCountRef.current = rep.repCount;
							setRepCount(rep.repCount);
							onRepRef.current?.();
							if (targetRepsRef.current && rep.repCount >= targetRepsRef.current) {
								stop();
							}
						}
					}

					// StateMachine + FormChecker stay on for phase display and per-rep
					// form scores — they no longer drive the visible counter.
					const smResult = stateMachine.current.update(
						angles,
						velocities,
						formResult.violations,
						formResult.passedCodes,
					);
					if (smResult.completedRep) {
						repHistory.current.push(smResult.completedRep);
					}
				} else {
					counterTrace.current.record({
						atMs: now,
						exercise,
						state: currentPhase,
						reason: 'Get into push-up position',
						signal: depth,
					});
					if (now - lastBodyMs.current > P.LOST_TIMEOUT_MS) {
						commitTrackingDetail('Get into push-up position');
						stateMachine.current.reset();
						velocityTracker.current.reset();
					}
				}
				}
			}

			// --- Five-lines watch: shoulders/elbows/wrists must stay tracked while
			// armed. Losing them never pauses counting — it only raises the
			// "Stand facing the camera" coaching event.
			const linesOk = FIVE_LINES_JOINTS.every(j => frame.visibility[j] >= P.FIVE_LINES_CONF);
			if (linesOk) lastLinesOkMs.current = now;
			const linesLost = lastLinesOkMs.current > 0 && now - lastLinesOkMs.current > P.FIVE_LINES_LOST_MS;

			// --- Coaching state ---
			let coach: CoachState;
			if (!shouldersPresent(frame.visibility)) {
				coach = tooClose(smoothedFrame)
					? 'TOO_CLOSE'
					: isRunningRef.current
						? 'STAND_FACING_CAMERA'
						: 'NO_BODY';
			} else if (tier === 'NO_BODY') {
				coach = isRunningRef.current ? 'STAND_FACING_CAMERA' : 'NO_BODY';
			} else if (!isRunningRef.current) {
				coach = isSquatExercise
					? squatMetrics
						? 'READY'
						: 'NOT_IN_SQUAT'
					: isBandedSideStep
						? squatMetrics
							? 'READY'
							: 'NOT_IN_SIDE_STEPS'
						: plankish
							? 'READY'
							: 'NOT_IN_PLANK';
			} else if (isLowerBodyExercise && !squatMetrics) {
				coach = 'STAND_FACING_CAMERA';
			} else if (!isLowerBodyExercise && linesLost) {
				coach = 'STAND_FACING_CAMERA';
			} else {
				coach = now - armedAtMs.current < P.GO_DISPLAY_MS ? 'GO' : 'COUNTING';
			}
			commitCoach(coach, now);
		},
			[
				measure,
				commitCoach,
				isBandedSideStep,
				isLowerBodyExercise,
				isSquatExercise,
				pose,
				publishSideStepTracking,
				publishSquatTracking,
				commitTrackingDetail,
				stop,
				resetDepthState,
			],
	);

	const handleDetectionError = useCallback((error: DetectionError) => {
		console.error('PoseDetection error:', error);
		setInitError(error.message || `Pose detection error (code ${error.code})`);
	}, []);

	const { solution, hasPermission, requestPermission } = useCameraService({
		onResults,
		onError: handleDetectionError,
		processingFps,
	});

	const signal: PushUpSignal = {
		position: signalPosition,
		confidence: signalConfidence,
		personDetected: signalPersonDetected,
		palmsPlanted: signalPalmsPlanted,
	};

	return {
		pose,
		signal,
		repCount,
		squatTracking,
		sideStepTracking,
		coachState,
		isRunning,
		debugInfo,
		trackingDetail,
		getCounterTrace: () => counterTrace.current.snapshot(),
		initError,
		androidPerformanceTier,
		solution,
		hasPermission,
		requestPermission,
		start,
		stop,
	};
}

export type { SharedValue };
