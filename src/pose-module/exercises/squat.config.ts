import type { ExerciseConfig, JointAngles } from '../types';

export const SQUAT_PARAMS = {
	// A pose score is noisy around ankles during fast movement. The detector's
	// time-based tracking grace (rather than a very high per-frame threshold)
	// protects against false counts without throwing away real jump frames.
	JOINT_CONFIDENCE_MIN: 0.45,
	TRACKING_GAP_MS: 300,
	TOP_KNEE_ANGLE: 158,
	BOTTOM_KNEE_ANGLE: 118,
	BOTTOM_EXIT_KNEE_ANGLE: 132,
	PULSE_UP_MIN_KNEE_ANGLE: 132,
	PULSE_UP_MAX_KNEE_ANGLE: 150,
	JUMP_MIN_ANKLE_LIFT_SW: 0.18,
	JUMP_MIN_ANKLE_RISE_SPEED_SW_S: 0.45,
	JUMP_MIN_LANDING_DESCENT_SW: 0.1,
	JUMP_LANDING_MAX_LIFT_SW: 0.08,
	JUMP_CONFIRM_FRAMES: 2,
	JUMP_LANDING_CONFIRM_FRAMES: 2,
	JUMP_MAX_AIR_MS: 1_400,
	MAX_TORSO_LEAN_DEG: 45,
	MIN_REP_MS: 350,
	MIN_BOTTOM_TO_PULSE_MS: 120,
	HOLD_MIN_MS: 750,
	HOLD_GRACE_MS: 250,
	HOLD_MAX_PELVIS_SPEED_SW_S: 0.22,
} as const;

function avgKnee(angles: JointAngles): number {
	return (angles.leftKnee + angles.rightKnee) / 2;
}

// The dedicated SquatDetector owns the live counter because it also separates
// pulse repetitions and timed holds. This config keeps the shared session
// contract valid for squat sessions and available for future form rules.
export const squatConfig: ExerciseConfig = {
	id: 'squat',
	phases: ['WAITING', 'MOVING_DOWN', 'BOTTOM', 'MOVING_UP', 'TOP'],
	countsRepOnTransitionTo: 'TOP',
	phaseTimeoutFrames: 180,
	transitions: {
		WAITING: {
			toPhase: 'MOVING_DOWN',
			condition: angles => avgKnee(angles) < SQUAT_PARAMS.TOP_KNEE_ANGLE,
			stableFrames: 3,
		},
		MOVING_DOWN: {
			toPhase: 'BOTTOM',
			condition: angles => avgKnee(angles) <= SQUAT_PARAMS.BOTTOM_KNEE_ANGLE,
			stableFrames: 2,
		},
		BOTTOM: {
			toPhase: 'MOVING_UP',
			condition: angles => avgKnee(angles) > SQUAT_PARAMS.BOTTOM_EXIT_KNEE_ANGLE,
			stableFrames: 2,
		},
		MOVING_UP: {
			toPhase: 'TOP',
			condition: angles => avgKnee(angles) >= SQUAT_PARAMS.TOP_KNEE_ANGLE,
			stableFrames: 3,
		},
		TOP: {
			toPhase: 'WAITING',
			condition: () => true,
			stableFrames: 1,
		},
	},
	formRules: [],
};

export const jumpSquatConfig: ExerciseConfig = {
	...squatConfig,
	id: 'jump-squat',
};
