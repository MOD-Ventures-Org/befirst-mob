import { PUSHUP_PARAMS } from '../exercises/pushup.config';
import { RepDetector } from '../repDetector';

const P = PUSHUP_PARAMS;

const TOP = 1.5;
const BOTTOM = 0.5;

function repFrames(top = TOP, bottom = BOTTOM): number[] {
	const steps = 6;
	const frames: number[] = [];

	for (let i = 0; i <= steps; i += 1) frames.push(top + ((bottom - top) * i) / steps);
	frames.push(bottom, bottom);
	for (let i = 1; i <= steps; i += 1) frames.push(bottom + ((top - bottom) * i) / steps);
	frames.push(top, top);

	return frames;
}

function playFrames(detector: RepDetector, frames: number[]): (number | null)[] {
	return frames.map(depth => detector.observeDepth(depth));
}

function playReps(detector: RepDetector, count: number, top = TOP, bottom = BOTTOM): (number | null)[] {
	const positions: (number | null)[] = [];
	for (let i = 0; i < count; i += 1) positions.push(...playFrames(detector, repFrames(top, bottom)));

	return positions;
}

describe('RepDetector display signal (games position)', () => {
	it('returns null until the first valid envelope', () => {
		const detector = new RepDetector();

		expect(detector.observeDepth(TOP)).toBeNull();
		expect(detector.observeDepth(TOP - P.REP_MIN_RANGE / 4)).toBeNull();
		expect(detector.observeDepth(BOTTOM)).not.toBeNull();
	});

	it('maps the top of a rep to ~1 and the bottom to ~0', () => {
		const detector = new RepDetector();
		playReps(detector, 4);

		expect(detector.observeDepth(TOP)).toBeCloseTo(1, 2);
		expect(detector.observeDepth(BOTTOM)).toBeCloseTo(0, 2);
		expect(detector.observeDepth((TOP + BOTTOM) / 2)).toBeCloseTo(0.5, 1);
	});

	it('recovers the mapping after an outlier spike ages out of the window', () => {
		const detector = new RepDetector();
		playReps(detector, 4);

		for (let i = 0; i < P.DISPLAY_ENVELOPE_TRIM + 3; i += 1) detector.observeDepth(TOP + 10);
		expect(detector.observeDepth(TOP)).toBeLessThan(0.5);

		const framesPerRep = repFrames().length;
		playReps(detector, Math.ceil(P.DISPLAY_WINDOW_FRAMES / framesPerRep) + 1);

		expect(detector.observeDepth(TOP)).toBeCloseTo(1, 2);
		expect(detector.observeDepth(BOTTOM)).toBeCloseTo(0, 2);
	});

	it('shrugs off isolated spurious frames without waiting for the window', () => {
		const detector = new RepDetector();
		playReps(detector, 4);

		for (let i = 0; i < P.DISPLAY_ENVELOPE_TRIM; i += 1) {
			detector.observeDepth(TOP + 8);
			detector.observeDepth(BOTTOM - 8);
			playFrames(detector, repFrames());
		}

		expect(detector.observeDepth(TOP)).toBeCloseTo(1, 2);
		expect(detector.observeDepth(BOTTOM)).toBeCloseTo(0, 2);
	});

	it('keeps the last envelope while the window is narrower than a rep', () => {
		const detector = new RepDetector();
		playReps(detector, 4);
		const held = detector.observeDepth(TOP) as number;

		let position: number | null = null;
		for (let i = 0; i < P.DISPLAY_WINDOW_FRAMES * 2; i += 1) {
			position = detector.observeDepth(TOP);
			expect(position).not.toBeNull();
		}

		expect(position as number).toBeCloseTo(held, 5);
		expect(detector.observeDepth(BOTTOM)).toBeCloseTo(0, 2);
	});

	it('keeps the envelope across resetSignal and clears it on reset', () => {
		const detector = new RepDetector();
		playReps(detector, 4);

		detector.resetSignal();
		expect(detector.observeDepth(TOP)).toBeCloseTo(1, 2);

		detector.reset();
		expect(detector.observeDepth(TOP)).toBeNull();
		expect(detector.getRepCount()).toBe(0);
	});

	it('rebuilds a fresh envelope after reset', () => {
		const detector = new RepDetector();
		playReps(detector, 4);
		detector.reset();

		playReps(detector, 4, 3, 1);

		expect(detector.observeDepth(3)).toBeCloseTo(1, 2);
		expect(detector.observeDepth(1)).toBeCloseTo(0, 2);
		expect(detector.observeDepth(2)).toBeCloseTo(0.5, 1);
	});

	it('does not change the counted reps', () => {
		const detector = new RepDetector();
		let now = 0;
		for (let i = 0; i < 5; i += 1) {
			for (const depth of repFrames()) {
				detector.observeDepth(depth);
				detector.update(depth, now);
				now += 60;
			}
		}

		expect(detector.getRepCount()).toBe(5);
	});
});
