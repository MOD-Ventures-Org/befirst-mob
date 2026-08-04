import { worldArmExtension } from '../geometry';
import type { JointVisibility, Skeleton, WorldSkeleton } from '../types';

function visibility(value = 0.9): JointVisibility {
	const output = {} as JointVisibility;
	for (const joint of Object.keys(skeleton()) as (keyof Skeleton)[]) output[joint] = value;
	return output;
}

function skeleton(): Skeleton {
	const point = { x: 0, y: 0 };
	return {
		nose: point,
		leftEye: point,
		rightEye: point,
		leftEar: point,
		rightEar: point,
		leftShoulder: point,
		rightShoulder: point,
		leftElbow: point,
		rightElbow: point,
		leftWrist: point,
		rightWrist: point,
		leftHip: point,
		rightHip: point,
		leftKnee: point,
		rightKnee: point,
		leftAnkle: point,
		rightAnkle: point,
	};
}

function world(wristDistance: number): WorldSkeleton {
	const output = {} as WorldSkeleton;
	for (const joint of Object.keys(skeleton()) as (keyof Skeleton)[]) output[joint] = { x: 0, y: 0, z: 0 };
	// Shoulder width = 1m. Keep the shoulders and wrists on a horizontal line
	// so screen-space vertical distance is zero: only the 3-D signal can see
	// the arm extension in this camera configuration.
	output.leftShoulder = { x: -0.5, y: 0, z: 0 };
	output.rightShoulder = { x: 0.5, y: 0, z: 0 };
	output.leftWrist = { x: -0.5, y: 0, z: wristDistance };
	output.rightWrist = { x: 0.5, y: 0, z: wristDistance };
	return output;
}

describe('worldArmExtension', () => {
	it('captures a front-camera push-up that has no vertical screen movement', () => {
		expect(worldArmExtension(world(1.8), visibility())).toBeCloseTo(1.8);
		expect(worldArmExtension(world(0.7), visibility())).toBeCloseTo(0.7);
	});

	it('keeps the valid arm when the other wrist is briefly occluded', () => {
		const v = visibility();
		v.rightWrist = 0.1;
		expect(worldArmExtension(world(1.2), v)).toBeCloseTo(1.2);
	});
});
