import type { PerfSnapshot } from './types';

export const PERF_SAMPLE_CAPACITY = 100;

// react-native-mediapipe only calls back once per *processed* frame, so there is
// no delivered-frame counter to compare against. Everything "dropped" is derived
// from this nominal target, never from a real camera frame count.
export const NOMINAL_TARGET_FPS = 30;

export interface PerfSampleBuffer {
	samples: number[];
	writeIndex: number;
	filled: number;
}

export const createPerfSampleBuffer = (capacity: number = PERF_SAMPLE_CAPACITY): PerfSampleBuffer => ({
	samples: new Array<number>(capacity).fill(0),
	writeIndex: 0,
	filled: 0,
});

export const resetPerfSampleBuffer = (buffer: PerfSampleBuffer): void => {
	buffer.writeIndex = 0;
	buffer.filled = 0;
};

export const addPerfSample = (buffer: PerfSampleBuffer, value: number): void => {
	buffer.samples[buffer.writeIndex] = value;
	buffer.writeIndex = (buffer.writeIndex + 1) % buffer.samples.length;
	if (buffer.filled < buffer.samples.length) {
		buffer.filled += 1;
	}
};

export const getPerfSamples = (buffer: PerfSampleBuffer): number[] => buffer.samples.slice(0, buffer.filled);

export const getAverage = (values: number[]): number => {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
};

// Nearest-rank percentile: the smallest sample at or above the requested rank.
export const getPercentile = (values: number[], percentile: number): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.ceil((percentile / 100) * sorted.length);
	const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
	return sorted[index];
};

export const getDroppedPercent = (cvFps: number, targetFps: number = NOMINAL_TARGET_FPS): number => {
	if (targetFps <= 0) return 0;
	const dropped = ((targetFps - cvFps) / targetFps) * 100;
	return Math.min(100, Math.max(0, dropped));
};

export const createPerfSnapshot = (buffer: PerfSampleBuffer, cvFps: number, sampleCount: number): PerfSnapshot => {
	const values = getPerfSamples(buffer);

	return {
		inferenceAvgMs: getAverage(values),
		inferenceP95Ms: getPercentile(values, 95),
		cvFps,
		targetFps: NOMINAL_TARGET_FPS,
		droppedPct: getDroppedPercent(cvFps),
		sampleCount,
	};
};
