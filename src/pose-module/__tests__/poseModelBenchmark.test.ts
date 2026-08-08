import { HEAVY_MODEL_BENCHMARK, heavyModelPassesBenchmark } from '../poseModelBenchmark';

describe('Heavy pose-model benchmark gate', () => {
	it('accepts a stable device that meets the FPS and p95 budgets', () => {
		expect(
			heavyModelPassesBenchmark({
				sampleCount: HEAVY_MODEL_BENCHMARK.minSamples,
				cvFps: 15,
				inferenceP95Ms: 65,
			}),
		).toBe(true);
	});

	it('rejects insufficient samples, low FPS, or slow inference', () => {
		expect(heavyModelPassesBenchmark({ sampleCount: 35, cvFps: 30, inferenceP95Ms: 20 })).toBe(false);
		expect(heavyModelPassesBenchmark({ sampleCount: 36, cvFps: 14, inferenceP95Ms: 20 })).toBe(false);
		expect(heavyModelPassesBenchmark({ sampleCount: 36, cvFps: 30, inferenceP95Ms: 66 })).toBe(false);
	});
});
