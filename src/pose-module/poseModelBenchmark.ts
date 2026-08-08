import type { PerfSnapshot } from './types';

// A Heavy-model build is eligible for promotion only after repeated physical
// device runs meet both limits. This is intentionally not an in-session model
// switch: changing a landmarker while someone exercises would discard tracking
// state and make the counter less reliable.
export const HEAVY_MODEL_BENCHMARK = {
	minProcessedFps: 15,
	maxInferenceP95Ms: 65,
	minSamples: 36,
} as const;

export function heavyModelPassesBenchmark(perf: Pick<PerfSnapshot, 'cvFps' | 'inferenceP95Ms' | 'sampleCount'>): boolean {
	return (
		perf.sampleCount >= HEAVY_MODEL_BENCHMARK.minSamples &&
		perf.cvFps >= HEAVY_MODEL_BENCHMARK.minProcessedFps &&
		perf.inferenceP95Ms <= HEAVY_MODEL_BENCHMARK.maxInferenceP95Ms
	);
}
