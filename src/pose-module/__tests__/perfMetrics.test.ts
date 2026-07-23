import {
	addPerfSample,
	createPerfSampleBuffer,
	createPerfSnapshot,
	getAverage,
	getDroppedPercent,
	getPercentile,
	getPerfSamples,
	NOMINAL_TARGET_FPS,
	resetPerfSampleBuffer,
} from '../perfMetrics';

describe('getPercentile', () => {
	it('returns 0 for an empty sample set', () => {
		expect(getPercentile([], 95)).toBe(0);
	});

	it('returns the only sample regardless of percentile', () => {
		expect(getPercentile([42], 95)).toBe(42);
		expect(getPercentile([42], 50)).toBe(42);
	});

	it('uses nearest-rank so p95 of 1..100 is 95', () => {
		const values = Array.from({ length: 100 }, (_, index) => index + 1);
		expect(getPercentile(values, 95)).toBe(95);
		expect(getPercentile(values, 50)).toBe(50);
		expect(getPercentile(values, 100)).toBe(100);
	});

	it('rounds the rank up on sample sets that do not divide evenly', () => {
		expect(getPercentile([10, 20, 30], 95)).toBe(30);
		expect(getPercentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
	});

	it('does not depend on input order and does not mutate the input', () => {
		const values = [90, 10, 50, 30, 70];
		expect(getPercentile(values, 95)).toBe(90);
		expect(values).toEqual([90, 10, 50, 30, 70]);
	});

	it('keeps a single spike out of p95 but reports it at the top rank', () => {
		const values = [...Array.from({ length: 19 }, () => 10), 500];
		expect(getPercentile(values, 95)).toBe(10);
		expect(getPercentile(values, 100)).toBe(500);
	});

	it('reports the spike at p95 once it covers more than 5% of the samples', () => {
		const values = [...Array.from({ length: 18 }, () => 10), 500, 500];
		expect(getPercentile(values, 95)).toBe(500);
	});
});

describe('getAverage', () => {
	it('returns 0 for an empty sample set', () => {
		expect(getAverage([])).toBe(0);
	});

	it('averages the samples', () => {
		expect(getAverage([10, 20, 30])).toBe(20);
	});
});

describe('perf sample buffer', () => {
	it('keeps only the most recent samples once the capacity is reached', () => {
		const buffer = createPerfSampleBuffer(3);
		[1, 2, 3, 4, 5].forEach(value => addPerfSample(buffer, value));
		expect(getPerfSamples(buffer).sort((a, b) => a - b)).toEqual([3, 4, 5]);
	});

	it('exposes only the filled slots before the buffer wraps', () => {
		const buffer = createPerfSampleBuffer(5);
		addPerfSample(buffer, 12);
		addPerfSample(buffer, 18);
		expect(getPerfSamples(buffer)).toEqual([12, 18]);
	});

	it('drops previous samples on reset', () => {
		const buffer = createPerfSampleBuffer(5);
		addPerfSample(buffer, 12);
		resetPerfSampleBuffer(buffer);
		expect(getPerfSamples(buffer)).toEqual([]);
	});
});

describe('getDroppedPercent', () => {
	it('is 0 when the processed rate meets or beats the nominal target', () => {
		expect(getDroppedPercent(30)).toBe(0);
		expect(getDroppedPercent(45)).toBe(0);
	});

	it('is derived from the nominal target', () => {
		expect(getDroppedPercent(15)).toBe(50);
		expect(getDroppedPercent(0)).toBe(100);
	});
});

describe('createPerfSnapshot', () => {
	it('reports avg, p95 and the nominal target', () => {
		const buffer = createPerfSampleBuffer(10);
		[10, 10, 10, 10, 10, 10, 10, 10, 10, 100].forEach(value => addPerfSample(buffer, value));

		const snapshot = createPerfSnapshot(buffer, 15, 240);

		expect(snapshot.inferenceAvgMs).toBe(19);
		expect(snapshot.inferenceP95Ms).toBe(100);
		expect(snapshot.cvFps).toBe(15);
		expect(snapshot.targetFps).toBe(NOMINAL_TARGET_FPS);
		expect(snapshot.droppedPct).toBe(50);
		expect(snapshot.sampleCount).toBe(240);
	});
});
