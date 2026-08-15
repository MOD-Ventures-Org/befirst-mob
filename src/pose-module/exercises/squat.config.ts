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
	// Jump Squats only need a clear loading dip before takeoff. Reusing the
	// regular-squat depth made athletes descend much farther than a natural,
	// continuous jump-squat rhythm requires.
	JUMP_BOTTOM_KNEE_ANGLE: 145,
	// A clearly extended knee lets regular Squats finish even if one ankle
	// briefly jitters upward. Near the regular top threshold we give the jump
	// detector its two-frame confirmation window first.
	JUMP_CLEAR_TOP_KNEE_ANGLE: 160,
	// Standard Squats use a shallow-but-distinct bottom. A 140° threshold
	// supports controlled phone-facing squats without requiring users to reach
	// a deep camera-projected bend; the 150° top still requires a clear return
	// to standing before a repetition can count.
	BOTTOM_KNEE_ANGLE: 140,
	BOTTOM_EXIT_KNEE_ANGLE: 140,
	// Keep the pulse-up band above the standard bottom threshold. If these
	// overlapped, holding still at the shallow bottom could arm a false pulse.
	PULSE_UP_MIN_KNEE_ANGLE: 145,
	PULSE_UP_MAX_KNEE_ANGLE: 148,
	// Jump Squats are evaluated in milliseconds, not frame counts: processed
	// camera FPS varies considerably across phones and can dip during take-off.
	// A replay may begin while the athlete is already moving, so jump detection
	// must not depend on a long standing-only calibration window. A short
	// timestamp confirmation still rejects one-frame landmark spikes.
	JUMP_TAKEOFF_CONFIRM_MS: 50,
	// After the knees first reach the phone-facing "top" estimate, retain the
	// squat baseline briefly. A real jump's highest foot displacement often
	// lands 1–2 processed frames after knee extension.
	JUMP_TAKEOFF_WINDOW_MS: 300,
	// Once a real takeoff has been sustained, the first clear descent verifies
	// the airborne arc. Waiting for an additional landing frame loses short
	// jumps when feet are occluded at ground contact.
	JUMP_LANDING_CONFIRM_MS: 0,
	JUMP_TRACKING_GAP_MS: 300,
	// Rising out of a squat can move the estimated feet by a few pixels. Do
	// not arm takeoff until the knees are nearly straight and the foot/hip rise
	// is large enough to be a real leave-the-floor movement.
	// A front camera routinely estimates a fully extended knee near the shared
	// top threshold rather than anatomical 180°. Foot/hip lift and velocity are
	// still required, so this does not turn an ordinary squat into a jump.
	JUMP_TAKEOFF_KNEE_ANGLE: 140,
	JUMP_FOOT_CONFIDENCE_MIN: 0.35,
	JUMP_MIN_FOOT_RISE_SW: 0.04,
	JUMP_MIN_ONE_FOOT_RISE_SW: 0.08,
	JUMP_MIN_PEAK_FOOT_RISE_SW: 0.055,
	JUMP_MIN_PELVIS_RISE_SW: 0.04,
	JUMP_MIN_RISE_SPEED_SW_S: 0.15,
	// A real jump has an airborne arc: after takeoff, the feet/hips must begin
	// descending from their peak. This is intentionally not a strict "feet back
	// on ground" check, which is often lost by a phone camera at landing.
	JUMP_MIN_DESCENT_FROM_PEAK_SW: 0.02,
	JUMP_MIN_FALL_SPEED_SW_S: 0.08,
	JUMP_MAX_AIR_MS: 1_800,
	MAX_TORSO_LEAN_DEG: 45,
	JUMP_MAX_TORSO_LEAN_DEG: 70,
	MIN_REP_MS: 350,
	// A verified jump already contains loading, takeoff, and descent, so a short
	// debounce is enough and does not suppress quick back-to-back repetitions.
	JUMP_MIN_REP_MS: 250,
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
