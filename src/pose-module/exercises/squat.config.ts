import type { ExerciseConfig, JointAngles } from '../types';

export const SQUAT_PARAMS = {
	// Feet and knees routinely receive lower landmark-confidence scores during
	// squats and jumps. We keep the complete body requirement, but accept
	// moderately confident joints and preserve detector state through a brief
	// occlusion rather than repeatedly resetting a real rep.
	JOINT_CONFIDENCE_MIN: 0.25,
	TRACKING_GAP_MS: 800,
	// Phone-facing landmarks flatten knee angles compared with a side view. The
	// original deep-only thresholds left ordinary, controlled squats uncounted.
	TOP_KNEE_ANGLE: 150,
	// A clearly extended knee lets regular Squats finish even if one ankle
	// briefly jitters upward. Near the regular top threshold we give the jump
	// detector its two-frame confirmation window first.
	JUMP_CLEAR_TOP_KNEE_ANGLE: 160,
	BOTTOM_KNEE_ANGLE: 130,
	BOTTOM_EXIT_KNEE_ANGLE: 140,
	PULSE_UP_MIN_KNEE_ANGLE: 140,
	PULSE_UP_MAX_KNEE_ANGLE: 148,
	JUMP_MIN_ANKLE_LIFT_SW: 0.1,
	JUMP_MIN_ANKLE_RISE_SPEED_SW_S: 0.25,
	JUMP_MIN_LANDING_DESCENT_SW: 0.06,
	JUMP_LANDING_MAX_LIFT_SW: 0.12,
	JUMP_CONFIRM_FRAMES: 2,
	JUMP_LANDING_CONFIRM_FRAMES: 1,
	JUMP_MAX_AIR_MS: 1_800,
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
