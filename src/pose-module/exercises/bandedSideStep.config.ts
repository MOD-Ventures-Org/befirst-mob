import type { ExerciseConfig } from '../types';

import { squatConfig } from './squat.config';

export const BANDED_SIDE_STEP_PARAMS = {
	LOW_SQUAT_MAX_KNEE_ANGLE: 145,
	MAX_TORSO_LEAN_DEG: 45,
	LEAD_DISTANCE_MIN_SW: 0.45,
	// The trailing foot must follow the leading foot by this much before the
	// detector rearms. This is independent of stance width so band tension does
	// not lock the detector after the first step.
	TRAIL_DISTANCE_MIN_SW: 0.25,
	RESET_STANCE_TOL_SW: 0.24,
	MIN_STEP_MS: 250,
	LOW_SQUAT_GRACE_MS: 250,
	HOLD_MIN_MS: 750,
	HOLD_GRACE_MS: 250,
	HOLD_MAX_PELVIS_SPEED_SW_S: 0.22,
	HOLD_MAX_FOOT_SPEED_SW_S: 0.2,
} as const;

// Side-step counting and holds are owned by BandedSideStepDetector. The shared
// config keeps this exercise available through the existing session registry.
export const bandedSideStepConfig: ExerciseConfig = {
	...squatConfig,
	id: 'banded-side-step',
};
