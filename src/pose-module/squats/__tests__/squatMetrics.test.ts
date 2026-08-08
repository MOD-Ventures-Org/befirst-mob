import { hasTrackableSquatBody, measureSquat } from '../squatMetrics';
import type { FootLandmarks, FootVisibility, JointVisibility, Skeleton } from '../../types';

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
		expect(measureSquat(skeleton, moderateConfidence)).toMatchObject({ kneeAngle: expect.any(Number) });
	});

	it('still rejects genuinely unreliable lower-body landmarks', () => {
		expect(hasTrackableSquatBody(visibility(0.2))).toBe(false);
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
});
