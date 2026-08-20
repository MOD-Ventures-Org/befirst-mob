import { SQUAT_PARAMS } from '../../exercises/squat.config';
import type { JointVisibility, Skeleton } from '../../types';
import { SquatDetector, type SquatUpdate } from '../SquatDetector';
import { isSquatBodyInFrame, measureSquat, type SquatMetrics } from '../squatMetrics';

type RawPose = 'top' | 'transition' | 'bottom';

interface PipelineStep {
	bodyInFrame: boolean;
	metrics: SquatMetrics | null;
	update: SquatUpdate;
}

function rawPose(position: RawPose, deltaX = 0): Skeleton {
	const centerX = 0.5 + deltaX;
	const top = position === 'top';
	const transition = position === 'transition';
	const shoulderY = top ? 0.15 : transition ? 0.2 : 0.24;
	const hipY = top ? 0.42 : transition ? 0.5 : 0.58;
	const kneeY = top ? 0.65 : transition ? 0.66 : 0.68;
	const ankleY = top ? 0.88 : transition ? 0.885 : 0.89;
	const kneeOffset = top ? 0.06 : transition ? 0.12 : 0.16;

	return {
		nose: { x: centerX, y: 0.08 },
		leftEye: { x: centerX - 0.01, y: 0.08 },
		rightEye: { x: centerX + 0.01, y: 0.08 },
		leftEar: { x: centerX - 0.02, y: 0.09 },
		rightEar: { x: centerX + 0.02, y: 0.09 },
		leftShoulder: { x: centerX - 0.08, y: shoulderY },
		rightShoulder: { x: centerX + 0.08, y: shoulderY },
		leftElbow: { x: centerX - 0.1, y: shoulderY + 0.12 },
		rightElbow: { x: centerX + 0.1, y: shoulderY + 0.12 },
		leftWrist: { x: centerX - 0.1, y: shoulderY + 0.24 },
		rightWrist: { x: centerX + 0.1, y: shoulderY + 0.24 },
		leftHip: { x: centerX - 0.06, y: hipY },
		rightHip: { x: centerX + 0.06, y: hipY },
		leftKnee: { x: centerX - kneeOffset, y: kneeY },
		rightKnee: { x: centerX + kneeOffset, y: kneeY },
		leftAnkle: { x: centerX - 0.06, y: ankleY },
		rightAnkle: { x: centerX + 0.06, y: ankleY },
	};
}

function strictVisibility(confidence = 0.95): JointVisibility {
	return Object.fromEntries(
		(Object.keys(rawPose('top')) as (keyof Skeleton)[]).map(joint => [joint, confidence]),
	) as JointVisibility;
}

function raisedLegWithDegenerateSupport(): Skeleton {
	const skeleton = rawPose('top');
	return {
		...skeleton,
		leftKnee: { x: 0.39, y: 0.56 },
		leftAnkle: { x: 0.41, y: 0.7 },
		// A confident zero-length hip-to-knee segment models the collapsed chain
		// MediaPipe can briefly emit while the other knee is raised.
		rightKnee: { ...skeleton.rightHip },
	};
}

function bilateralPulseUpPose(): Skeleton {
	const skeleton = rawPose('transition');
	return {
		...skeleton,
		// Both measured knee angles are about 146.7 degrees: above the regular
		// bottom, but still low enough to be a small, grounded pulse.
		leftKnee: { x: 0.384, y: 0.66 },
		rightKnee: { x: 0.616, y: 0.66 },
	};
}

function asymmetricPulseHallucination(): Skeleton {
	const skeleton = rawPose('bottom');
	return {
		...skeleton,
		// One chain remains deeply bent while the other is straight. Their mean
		// is about 147.4 degrees, which used to satisfy the pulse-up mean-angle
		// band even though this is not a bilateral pulse.
		leftKnee: { x: 0.35, y: 0.68 },
		rightKnee: { x: 0.56, y: 0.7 },
	};
}

function processStandardFrame(
	detector: SquatDetector,
	skeleton: Skeleton | null,
	visibility: JointVisibility,
	nowMs: number,
): PipelineStep {
	const bodyInFrame =
		skeleton !== null &&
		isSquatBodyInFrame(
			skeleton,
			visibility,
			false,
			SQUAT_PARAMS.STANDARD_JOINT_CONFIDENCE_MIN,
		);
	const metrics =
		bodyInFrame && skeleton
			? measureSquat(skeleton, visibility, undefined, {
					allowSingleSide: false,
					minimumConfidence: SQUAT_PARAMS.STANDARD_JOINT_CONFIDENCE_MIN,
				})
			: null;
	const update = metrics ? detector.update(metrics, nowMs) : detector.gap(nowMs);
	return { bodyInFrame, metrics, update };
}

function playTrace(
	detector: SquatDetector,
	visibility: JointVisibility,
	trace: Array<[number, Skeleton | null]>,
): PipelineStep[] {
	return trace.map(([nowMs, skeleton]) => processStandardFrame(detector, skeleton, visibility, nowMs));
}

describe('standard squat raw production pipeline', () => {
	it('counts one valid controlled raw-landmark squat', () => {
		const detector = new SquatDetector('standard');
		const visibility = strictVisibility();
		const steps = playTrace(detector, visibility, [
			[0, rawPose('top')],
			[100, rawPose('top')],
			[200, rawPose('top')],
			[300, rawPose('top')],
			[400, rawPose('transition')],
			[500, rawPose('bottom')],
			[600, rawPose('bottom')],
			[700, rawPose('bottom')],
			[800, rawPose('transition')],
			[900, rawPose('top')],
			[1_000, rawPose('top')],
			[1_100, rawPose('top')],
		]);

		expect(steps.every(step => step.bodyInFrame && step.metrics !== null)).toBe(true);
		expect(steps.filter(step => step.update.rep?.variant === 'standard')).toHaveLength(1);
		expect(steps[steps.length - 1].update.repCounts.standard).toBe(1);
	});

	it('routes a raised-leg pose with a degenerate support chain through gap() and cancels it', () => {
		const detector = new SquatDetector('standard');
		const visibility = strictVisibility();
		playTrace(detector, visibility, [
			[0, rawPose('top')],
			[100, rawPose('top')],
			[200, rawPose('top')],
			[300, rawPose('top')],
		]);

		const raised = processStandardFrame(detector, raisedLegWithDegenerateSupport(), visibility, 400);
		expect(raised.bodyInFrame).toBe(true);
		expect(raised.metrics).toBeNull();
		expect(raised.update.status).toContain('rep cancelled');

		const standingReturn = playTrace(detector, visibility, [
			[500, rawPose('top')],
			[600, rawPose('top')],
			[700, rawPose('top')],
			[800, rawPose('top')],
		]);
		expect(standingReturn.every(step => step.update.repCounts.standard === 0)).toBe(true);
		expect(standingReturn[standingReturn.length - 1].update.repCounts.standard).toBe(0);
	});

	it('rejects an asymmetric one-leg pulse hallucination even when the average angle is in the pulse band', () => {
		const detector = new SquatDetector('standard');
		const visibility = strictVisibility();
		const beforePulse = playTrace(detector, visibility, [
			[0, rawPose('top')],
			[100, rawPose('top')],
			[200, rawPose('top')],
			[300, rawPose('top')],
			[400, rawPose('transition')],
			[500, rawPose('bottom')],
			[600, rawPose('bottom')],
			[700, rawPose('bottom')],
			[800, rawPose('bottom')],
			[900, rawPose('bottom')],
		]);
		expect(beforePulse[beforePulse.length - 1].update.activeVariant).toBe('standard');

		const asymmetric = processStandardFrame(
			detector,
			asymmetricPulseHallucination(),
			visibility,
			1_000,
		);
		expect(asymmetric.bodyInFrame).toBe(true);
		expect(asymmetric.metrics).not.toBeNull();
		expect(asymmetric.metrics!.kneeAngle).toBeGreaterThanOrEqual(SQUAT_PARAMS.PULSE_UP_MIN_KNEE_ANGLE);
		expect(asymmetric.metrics!.kneeAngle).toBeLessThanOrEqual(SQUAT_PARAMS.PULSE_UP_MAX_KNEE_ANGLE);
		expect(asymmetric.metrics!.leftKneeAngle).toBeLessThan(SQUAT_PARAMS.BOTTOM_KNEE_ANGLE);
		expect(asymmetric.metrics!.rightKneeAngle).toBeGreaterThanOrEqual(SQUAT_PARAMS.TOP_KNEE_ANGLE);

		const bottomReturn = playTrace(detector, visibility, [
			[1_100, rawPose('bottom')],
			[1_200, rawPose('bottom')],
			[1_300, rawPose('bottom')],
		]);
		expect(asymmetric.update.rep).toBeUndefined();
		expect(bottomReturn.every(step => step.update.rep === undefined)).toBe(true);
		expect(bottomReturn[bottomReturn.length - 1].update.repCounts.pulse).toBe(0);
		expect(bottomReturn[bottomReturn.length - 1].update.totalReps).toBe(0);
	});

	it('counts one sustained bilateral raw-landmark pulse', () => {
		const detector = new SquatDetector('standard');
		const visibility = strictVisibility();
		const steps = playTrace(detector, visibility, [
			[0, rawPose('top')],
			[100, rawPose('top')],
			[200, rawPose('top')],
			[300, rawPose('top')],
			[400, rawPose('transition')],
			[500, rawPose('bottom')],
			[600, rawPose('bottom')],
			[700, rawPose('bottom')],
			[800, rawPose('bottom')],
			[900, bilateralPulseUpPose()],
			[1_000, bilateralPulseUpPose()],
			[1_100, bilateralPulseUpPose()],
			[1_200, rawPose('bottom')],
			[1_300, rawPose('bottom')],
			[1_400, rawPose('bottom')],
		]);

		expect(steps.every(step => step.bodyInFrame && step.metrics !== null)).toBe(true);
		expect(steps.filter(step => step.update.rep?.variant === 'pulse')).toHaveLength(1);
		expect(steps[steps.length - 1].update.repCounts.pulse).toBe(1);
		expect(steps[steps.length - 1].update.totalReps).toBe(1);
	});

	it('does not count a lateral walking exit with bottom-like edge hallucinations', () => {
		const detector = new SquatDetector('standard');
		const visibility = strictVisibility();
		const steps = playTrace(detector, visibility, [
			[0, rawPose('top')],
			[100, rawPose('top')],
			[200, rawPose('top')],
			[300, rawPose('top')],
			[400, rawPose('transition', 0.03)],
			[500, rawPose('bottom', 0.08)],
			[600, rawPose('bottom', 0.16)],
			[700, rawPose('bottom', 0.24)],
			[800, rawPose('top', 0.35)],
			[900, rawPose('top', 0.4)],
			[1_000, rawPose('top')],
			[1_100, rawPose('top')],
			[1_200, rawPose('top')],
			[1_300, rawPose('top')],
		]);

		expect(steps[9].bodyInFrame).toBe(false);
		expect(steps.every(step => step.update.rep === undefined)).toBe(true);
		expect(steps[steps.length - 1].update.repCounts.standard).toBe(0);
	});

	it('cancels a confirmed bottom on out-of-frame/null input and recalibrates on standing re-entry', () => {
		const detector = new SquatDetector('standard');
		const visibility = strictVisibility();
		const beforeLoss = playTrace(detector, visibility, [
			[0, rawPose('top')],
			[100, rawPose('top')],
			[200, rawPose('top')],
			[300, rawPose('top')],
			[400, rawPose('transition')],
			[500, rawPose('bottom')],
			[600, rawPose('bottom')],
			[700, rawPose('bottom')],
		]);
		expect(beforeLoss[beforeLoss.length - 1].update.activeVariant).toBe('standard');

		const outside = processStandardFrame(detector, rawPose('bottom', 0.5), visibility, 800);
		const missing = processStandardFrame(detector, null, visibility, 900);
		expect(outside.bodyInFrame).toBe(false);
		expect(outside.update.status).toContain('rep cancelled');
		expect(missing.metrics).toBeNull();

		const standingReturn = playTrace(detector, visibility, [
			[1_000, rawPose('top')],
			[1_100, rawPose('top')],
			[1_200, rawPose('top')],
			[1_300, rawPose('top')],
		]);
		expect(standingReturn[0].update.status).toBe('Get your full body in frame');
		expect(standingReturn[standingReturn.length - 1].update.status).toBe('Lower into your squat');
		expect(standingReturn[standingReturn.length - 1].update.repCounts.standard).toBe(0);
	});
});
