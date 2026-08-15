import { hasTrackableSquatBody, measureSquat, squatFramingWarning } from '../squatMetrics';
import type { FootLandmarks, FootVisibility, JointVisibility, Skeleton, WorldSkeleton } from '../../types';

const skeleton: Skeleton = {
	nose: { x: 50, y: 10 },
	leftEye: { x: 42, y: 14 },
	rightEye: { x: 58, y: 14 },
	leftEar: { x: 35, y: 18 },
	rightEar: { x: 65, y: 18 },
	leftShoulder: { x: 20, y: 50 },
	rightShoulder: { x: 80, y: 50 },
	leftElbow: { x: 15, y: 90 },
	rightElbow: { x: 85, y: 90 },
	leftWrist: { x: 12, y: 125 },
	rightWrist: { x: 88, y: 125 },
	leftHip: { x: 28, y: 135 },
	rightHip: { x: 72, y: 135 },
	leftKnee: { x: 20, y: 205 },
	rightKnee: { x: 80, y: 205 },
	leftAnkle: { x: 18, y: 280 },
	rightAnkle: { x: 82, y: 280 },
};

function visibility(value: number): JointVisibility {
	return Object.fromEntries(Object.keys(skeleton).map(joint => [joint, value])) as JointVisibility;
}

const feet: FootLandmarks = {
	leftHeel: { x: 16, y: 286 },
	rightHeel: { x: 84, y: 288 },
	leftFootIndex: { x: 20, y: 296 },
	rightFootIndex: { x: 80, y: 294 },
};

const footVisibility: FootVisibility = {
	leftHeel: 0.9,
	rightHeel: 0.9,
	leftFootIndex: 0.9,
	rightFootIndex: 0.9,
};

describe('squat metrics', () => {
	it('keeps a full lower body trackable at moderate ankle and knee confidence', () => {
		const moderateConfidence = visibility(0.3);

		expect(hasTrackableSquatBody(moderateConfidence)).toBe(true);
		expect(measureSquat(skeleton, moderateConfidence)).toMatchObject({
			kneeAngle: expect.any(Number),
			isUpright: true,
		});
	});

	it('marks a kneeling or plank-like full body as not upright for normal squats', () => {
		const plankLike: Skeleton = {
			...skeleton,
			leftShoulder: { x: 20, y: 100 },
			rightShoulder: { x: 80, y: 100 },
			leftHip: { x: 28, y: 135 },
			rightHip: { x: 72, y: 135 },
			leftKnee: { x: 20, y: 160 },
			rightKnee: { x: 80, y: 160 },
			leftAnkle: { x: 18, y: 175 },
			rightAnkle: { x: 82, y: 175 },
		};

		expect(measureSquat(plankLike, visibility(0.9))).toMatchObject({
			isUpright: false,
			verticalAnkleSpanSW: expect.any(Number),
		});
	});

	it('accepts an upright lower-body span above the push-up rejection boundary', () => {
		const uprightButWideAngle: Skeleton = {
			...skeleton,
			leftShoulder: { x: 20, y: 100 },
			rightShoulder: { x: 80, y: 100 },
			leftAnkle: { x: 18, y: 191 },
			rightAnkle: { x: 82, y: 191 },
		};

		expect(measureSquat(uprightButWideAngle, visibility(0.9))).toMatchObject({
			isUpright: true,
			verticalAnkleSpanSW: expect.any(Number),
		});
	});

	it('still rejects genuinely unreliable lower-body landmarks', () => {
		expect(hasTrackableSquatBody(visibility(0.2))).toBe(false);
	});

	it('advises when a full squat body is too close or too far in the frame', () => {
		const tooFar: Skeleton = {
			...skeleton,
			leftShoulder: { x: 0.45, y: 0.35 },
			rightShoulder: { x: 0.55, y: 0.35 },
			leftHip: { x: 0.46, y: 0.45 },
			rightHip: { x: 0.54, y: 0.45 },
			leftKnee: { x: 0.45, y: 0.55 },
			rightKnee: { x: 0.55, y: 0.55 },
			leftAnkle: { x: 0.45, y: 0.65 },
			rightAnkle: { x: 0.55, y: 0.65 },
		};
		const tooClose: Skeleton = {
			...skeleton,
			leftShoulder: { x: 0.02, y: 0.02 },
			rightShoulder: { x: 0.98, y: 0.02 },
			leftHip: { x: 0.1, y: 0.3 },
			rightHip: { x: 0.9, y: 0.3 },
			leftKnee: { x: 0.12, y: 0.62 },
			rightKnee: { x: 0.88, y: 0.62 },
			leftAnkle: { x: 0.18, y: 0.98 },
			rightAnkle: { x: 0.82, y: 0.98 },
		};
		const wellFramed: Skeleton = {
			...tooFar,
			leftShoulder: { x: 0.35, y: 0.15 },
			rightShoulder: { x: 0.65, y: 0.15 },
			leftHip: { x: 0.4, y: 0.35 },
			rightHip: { x: 0.6, y: 0.35 },
			leftKnee: { x: 0.38, y: 0.58 },
			rightKnee: { x: 0.62, y: 0.58 },
			leftAnkle: { x: 0.36, y: 0.78 },
			rightAnkle: { x: 0.64, y: 0.78 },
		};

		expect(squatFramingWarning(tooFar, visibility(0.9))).toBe('too-far');
		expect(squatFramingWarning(tooClose, visibility(0.9))).toBe('too-close');
		expect(squatFramingWarning(wellFramed, visibility(0.9))).toBeNull();

		const kneeHidden = visibility(0.9);
		kneeHidden.rightKnee = 0.24;
		expect(squatFramingWarning(wellFramed, kneeHidden)).toBe('knees-not-visible');
	});

	it('uses the lowest confidently tracked heel/toe point for each foot', () => {
		const metrics = measureSquat(skeleton, visibility(0.9), { skeleton: feet, visibility: footVisibility });

		expect(metrics).toMatchObject({
			leftFootY: 296,
			rightFootY: 294,
			leftFootConfidence: 0.9,
			rightFootConfidence: 0.9,
		});
	});

	it('falls back to ankle coordinates when heel and toe confidence is low', () => {
		const lowFootConfidence: FootVisibility = {
			leftHeel: 0.1,
			rightHeel: 0.1,
			leftFootIndex: 0.1,
			rightFootIndex: 0.1,
		};
		const metrics = measureSquat(skeleton, visibility(0.9), {
			skeleton: feet,
			visibility: lowFootConfidence,
		});

		expect(metrics).toMatchObject({ leftFootY: 280, rightFootY: 280 });
	});

	it('uses the visible leg for a side-view Jump Squat when the rear leg is occluded', () => {
		const sideViewVisibility = visibility(0.9);
		sideViewVisibility.rightShoulder = 0.1;
		sideViewVisibility.rightHip = 0.1;
		sideViewVisibility.rightKnee = 0.1;
		sideViewVisibility.rightAnkle = 0.1;

		expect(hasTrackableSquatBody(sideViewVisibility)).toBe(false);
		expect(hasTrackableSquatBody(sideViewVisibility, true)).toBe(true);
		expect(
			measureSquat(skeleton, sideViewVisibility, { skeleton: feet, visibility: footVisibility }, { allowSingleSide: true }),
		).toMatchObject({
			kneeAngle: expect.any(Number),
			shoulderWidth: expect.any(Number),
			leftFootConfidence: 0.9,
			rightFootConfidence: 0.1,
			});
	});

	it('exposes MediaPipe world shoulder width as an optional metric scale', () => {
		const world = Object.fromEntries(
			Object.keys(skeleton).map(joint => [joint, { x: 0, y: 0, z: 0 }]),
		) as WorldSkeleton;
		world.leftShoulder = { x: -0.2, y: 0, z: 0 };
		world.rightShoulder = { x: 0.2, y: 0, z: 0 };

		const metrics = measureSquat(skeleton, visibility(0.9), undefined, { world });

		expect(metrics?.estimatedShoulderWidthM).toBeCloseTo(0.4);
	});
});
