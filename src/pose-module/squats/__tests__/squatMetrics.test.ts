import { hasTrackableSquatBody, measureSquat } from '../squatMetrics';
import type { JointVisibility, Skeleton } from '../../types';

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

describe('squat metrics', () => {
	it('keeps a full lower body trackable at moderate ankle and knee confidence', () => {
		const moderateConfidence = visibility(0.3);

		expect(hasTrackableSquatBody(moderateConfidence)).toBe(true);
		expect(measureSquat(skeleton, moderateConfidence)).toMatchObject({ kneeAngle: expect.any(Number) });
	});

	it('still rejects genuinely unreliable lower-body landmarks', () => {
		expect(hasTrackableSquatBody(visibility(0.2))).toBe(false);
	});
});
