import { BandedSideStepDetector } from '../BandedSideStepDetector';
import type { SquatMetrics } from '../../squats/squatMetrics';

function frame(
	leftAnkleX = 100,
	rightAnkleX = 200,
	pelvisY = 420,
	kneeAngle = 130,
	estimatedShoulderWidthM?: number,
): SquatMetrics {
	return {
		kneeAngle,
		stanceWidth: Math.abs(rightAnkleX - leftAnkleX) / 100,
		pelvisY,
		ankleY: 520,
		leftAnkleY: 520,
		rightAnkleY: 520,
		leftAnkleX,
		rightAnkleX,
		shoulderWidth: 100,
		torsoLean: 8,
		...(estimatedShoulderWidthM ? { estimatedShoulderWidthM } : {}),
	};
}

describe('BandedSideStepDetector', () => {
	it('counts alternating leading left and right side steps', () => {
		const detector = new BandedSideStepDetector();
		detector.update(frame(), 0);
		const left = detector.update(frame(50, 200), 500);
		detector.update(frame(50, 150), 800);
		const right = detector.update(frame(50, 200), 1_100);

		expect(left.step).toMatchObject({ direction: 'left', totalSteps: 1 });
		expect(right.step).toMatchObject({ direction: 'right', totalSteps: 2 });
		expect(right).toMatchObject({ leftSteps: 1, rightSteps: 1, totalSteps: 2 });
	});

	it('counts an outward anatomical-left step when the front image is unmirrored', () => {
		// In an unmirrored front-camera image, the athlete's anatomical left
		// appears on screen-right. The old detector assumed fixed screen sides and
		// therefore measured this normal outward movement as negative distance.
		const detector = new BandedSideStepDetector();
		detector.update(frame(200, 100), 0);
		const left = detector.update(frame(250, 100), 500);

		expect(left.step).toMatchObject({ direction: 'left', totalSteps: 1 });
	});

	it('counts a modest outward step from a shallow athletic squat', () => {
		const detector = new BandedSideStepDetector();
		detector.update(frame(100, 200, 420, 150), 0);
		const step = detector.update(frame(70, 200, 420, 150), 500);

		expect(step.step).toMatchObject({ direction: 'left', totalSteps: 1 });
	});

	it('rearms once the trailing foot catches up even when the band keeps a wide stance', () => {
		const detector = new BandedSideStepDetector();
		detector.update(frame(100, 220), 0);
		const first = detector.update(frame(50, 220), 500);
		// The trailing right foot follows left by 0.25 shoulder widths. The new
		// stance remains 0.25 widths wider than the baseline, so the old
		// width-only rearm condition would remain stuck in LEADING forever.
		detector.update(frame(50, 195), 800);
		const second = detector.update(frame(0, 195), 1_100);

		expect(first.step).toMatchObject({ direction: 'left', totalSteps: 1 });
		expect(second.step).toMatchObject({ direction: 'left', totalSteps: 2 });
		expect(second.stepHistory).toMatchObject([
			{ id: 1, direction: 'left', distanceSW: 0.5 },
			{ id: 2, direction: 'left', distanceSW: 0.5 },
		]);
	});

	it('records the maximum distance reached before the trailing foot closes the stance', () => {
		const detector = new BandedSideStepDetector();
		detector.update(frame(100, 200), 0);
		const counted = detector.update(frame(70, 200), 300);
		const extended = detector.update(frame(50, 200), 500);
		const closed = detector.update(frame(50, 175), 700);

		expect(counted.step).toMatchObject({ direction: 'left', distanceSW: 0.3 });
		expect(extended.activeStep).toMatchObject({ direction: 'left', distanceSW: 0.5 });
		expect(closed.activeStep).toBeNull();
		expect(closed.lastStep).toMatchObject({ direction: 'left', distanceSW: 0.5 });
		expect(closed.averageDistanceSW).toBeCloseTo(0.5);
		expect(closed.longestDistanceSW).toBeCloseTo(0.5);
	});

	it('provides an estimated centimetre distance when world-landmark scale is available', () => {
		const detector = new BandedSideStepDetector();
		detector.update(frame(100, 200, 420, 130, 0.4), 0);
		const counted = detector.update(frame(70, 200, 420, 130, 0.4), 300);
		const extended = detector.update(frame(50, 200, 420, 130, 0.4), 500);

		expect(counted.step).toMatchObject({ distanceSW: 0.3, estimatedDistanceCm: 12 });
		expect(extended.activeStep?.estimatedDistanceCm).toBeCloseTo(20);
	});

	it('times a stable low-squat hold and saves it when the session finishes', () => {
		const detector = new BandedSideStepDetector();
		detector.update(frame(), 0);
		detector.update(frame(), 100);
		const live = detector.update(frame(), 1_000);
		const completed = detector.finish(1_200);

		expect(live.activeHold?.durationMs).toBe(900);
		expect(completed.completedHold).toMatchObject({ position: 'low-squat', durationMs: 900 });
		expect(completed.holds).toHaveLength(1);
	});
});
