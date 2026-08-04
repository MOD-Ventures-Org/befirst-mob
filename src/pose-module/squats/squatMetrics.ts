import { angleAt, conf, midpoint, shoulderWidth } from '../geometry';
import { SQUAT_PARAMS } from '../exercises/squat.config';
import type { JointVisibility, Skeleton } from '../types';

export interface SquatMetrics {
	kneeAngle: number;
	stanceWidth: number;
	pelvisY: number;
	ankleY: number;
	leftAnkleY: number;
	rightAnkleY: number;
	leftAnkleX: number;
	rightAnkleX: number;
	shoulderWidth: number;
	torsoLean: number;
}

const REQUIRED_JOINTS: (keyof Skeleton)[] = [
	'leftShoulder',
	'rightShoulder',
	'leftHip',
	'rightHip',
	'leftKnee',
	'rightKnee',
	'leftAnkle',
	'rightAnkle',
];

export function hasTrackableSquatBody(visibility: JointVisibility): boolean {
	return REQUIRED_JOINTS.every(joint => conf(visibility, joint) >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN);
}

// Returns front-camera squat measurements in shoulder-width units where
// practical, keeping the detector independent of the athlete's distance from
// the phone.
export function measureSquat(skeleton: Skeleton, visibility: JointVisibility): SquatMetrics | null {
	if (!hasTrackableSquatBody(visibility)) return null;

	const width = shoulderWidth(skeleton);
	if (width <= 0) return null;

	const leftKnee = angleAt(skeleton.leftKnee, skeleton.leftHip, skeleton.leftAnkle);
	const rightKnee = angleAt(skeleton.rightKnee, skeleton.rightHip, skeleton.rightAnkle);
	if (leftKnee === null || rightKnee === null) return null;

	const shoulderMid = midpoint(skeleton.leftShoulder, skeleton.rightShoulder);
	const hipMid = midpoint(skeleton.leftHip, skeleton.rightHip);
	const torsoLean = Math.abs((Math.atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y) * 180) / Math.PI);

	return {
		kneeAngle: (leftKnee + rightKnee) / 2,
		stanceWidth: Math.abs(skeleton.leftAnkle.x - skeleton.rightAnkle.x) / width,
		pelvisY: hipMid.y,
		ankleY: (skeleton.leftAnkle.y + skeleton.rightAnkle.y) / 2,
		leftAnkleY: skeleton.leftAnkle.y,
		rightAnkleY: skeleton.rightAnkle.y,
		leftAnkleX: skeleton.leftAnkle.x,
		rightAnkleX: skeleton.rightAnkle.x,
		shoulderWidth: width,
		torsoLean,
	};
}
