import type { ExerciseConfig } from '../types';

import { pushupConfig } from './pushup.config';

const registry: Record<string, ExerciseConfig> = {
	pushup: pushupConfig,
	'pushup-pyramid': pushupConfig,
};

export function getExerciseConfig(id: string): ExerciseConfig {
	const config = registry[id];
	if (!config) {
		throw new Error(`Unknown exercise: "${id}"`);
	}
	return config;
}
