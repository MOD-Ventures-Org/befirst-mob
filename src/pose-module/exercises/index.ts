import type { ExerciseConfig } from '../types';

import { bandedSideStepConfig } from './bandedSideStep.config';
import { pushupConfig } from './pushup.config';
import { jumpSquatConfig, squatConfig } from './squat.config';

const registry: Record<string, ExerciseConfig> = {
	pushup: pushupConfig,
	'pushup-pyramid': pushupConfig,
	squat: squatConfig,
	'jump-squat': jumpSquatConfig,
	'banded-side-step': bandedSideStepConfig,
};

export function getExerciseConfig(id: string): ExerciseConfig {
	const config = registry[id];
	if (!config) {
		throw new Error(`Unknown exercise: "${id}"`);
	}
	return config;
}
