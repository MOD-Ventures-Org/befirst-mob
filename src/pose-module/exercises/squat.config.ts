import type { ExerciseConfig, JointAngles } from '../types';

export const SQUAT_PARAMS = {
	// Feet and knees routinely receive lower landmark-confidence scores during
	// squats and jumps. We keep the complete body requirement, but accept
	// moderately confident joints and preserve detector state through a brief
	// occlusion rather than repeatedly resetting a real rep.
	JOINT_CONFIDENCE_MIN: 0.25,
	// Standard Squats trade a short tracking reset for trustworthy bilateral
	// evidence. Jump Squats retain the lower shared threshold because takeoff can
	// briefly occlude one leg and has its own multi-signal verification.
	STANDARD_JOINT_CONFIDENCE_MIN: 0.5,
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
	STANDARD_BOTTOM_KNEE_ANGLE_MIN: 110,
	STANDARD_BOTTOM_KNEE_ANGLE_MAX: 145,
	STANDARD_BOTTOM_KNEE_ANGLE_STEP: 5,
	BOTTOM_EXIT_KNEE_ANGLE: 140,
	// A normal squat must be a bilateral, grounded movement. Requiring both
	// knees prevents a standing knee raise from turning the averaged knee angle
	// into a fake squat, while the pelvis/foot checks reject walking, stepping,
	// and landmark slides as the athlete leaves the frame.
	STANDARD_PHASE_CONFIRM_MS: 120,
	STANDARD_PHASE_CONFIRM_MIN_SAMPLES: 3,
	STANDARD_PHASE_MAX_GAP_MS: 180,
	STANDARD_PULSE_CONFIRM_MS: 70,
	STANDARD_PULSE_CONFIRM_MIN_SAMPLES: 2,
	STANDARD_MIN_PULSE_KNEE_EXCURSION_DEG: 8,
	STANDARD_MIN_PULSE_COMPRESSION_RELEASE_SW: 0.06,
	STANDARD_MAX_PULSE_EXCURSION_ASYMMETRY_DEG: 10,
	// A standard repetition must be one continuous, ordered movement. These
	// limits reject a bottom pose that survives a silent native tracking gap and
	// prevent two sparse landmark samples from satisfying a time-only phase gate.
	STANDARD_MAX_SAMPLE_GAP_MS: 300,
	STANDARD_CALIBRATION_MS: 300,
	STANDARD_CALIBRATION_MIN_SAMPLES: 4,
	STANDARD_MIN_CYCLE_MS: 600,
	STANDARD_MAX_CYCLE_MS: 8_000,
	STANDARD_MIN_PELVIS_DROP_SW: 0.2,
	STANDARD_MAX_FOOT_TRAVEL_SW: 0.12,
	STANDARD_MAX_STANCE_CHANGE_SW: 0.25,
	STANDARD_MAX_KNEE_DIFFERENCE_DEG: 30,
	// Baseline continuity and translation-invariant depth checks. A real Squat
	// compresses both hip-to-foot heights while the athlete remains in roughly
	// the same camera position and scale, then restores that height at the top.
	STANDARD_MAX_BODY_CENTER_SHIFT_SW: 0.35,
	STANDARD_MAX_SCALE_CHANGE_RATIO: 0.2,
	STANDARD_MIN_HIP_FOOT_COMPRESSION_SW: 0.18,
	STANDARD_MAX_HIP_FOOT_ASYMMETRY_SW: 0.12,
	STANDARD_TOP_RECOVERY_TOLERANCE_SW: 0.1,
	// Landmarks exactly on an image edge are commonly only a partial body. Keep
	// a small normalized margin so a rep cannot be armed while a foot or hip is
	// already crossing out of the camera image.
	BODY_FRAME_EDGE_MARGIN: 0.06,
	// A kneeling or plank position can also produce a bent-knee → straight-knee
	// sequence. Normal Squats must keep the ankles sufficiently below the
	// shoulders in the portrait camera plane before that sequence can count.
	// 1.5 distinguishes the close, kneeling push-up framing (about 1–1.3 SW
	// from shoulders to ankles) while remaining tolerant of wide-angle phones
	// and full-body standing squat framing.
	MIN_UPRIGHT_ANKLE_SPAN_SW: 1.5,
	// Framing warnings only: counting remains live while we guide the athlete to
	// a clearer camera distance. Span uses normalized image coordinates, making
	// it independent of device resolution and frame orientation.
	MIN_BODY_FRAME_SPAN: 0.5,
	MAX_BODY_FRAME_SPAN: 0.92,
	// Legacy UI labels retained for coaching/tests. Detection itself is relative
	// to the person's confirmed bottom, not an exact absolute-angle dwell.
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
