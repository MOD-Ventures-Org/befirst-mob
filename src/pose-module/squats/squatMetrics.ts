import { angleAt, conf, midpoint, shoulderWidth } from '../geometry';
import { SQUAT_PARAMS } from '../exercises/squat.config';
import type { FootLandmarks, FootVisibility, JointVisibility, Skeleton } from '../types';

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
	// Lowest confidently visible point on each foot. These fall back to the
	// ankle on frames from older bridges/tests, but use heel/toe landmarks on
	// current MediaPipe frames so a single jittery ankle cannot decide a jump.
	leftFootY?: number;
	rightFootY?: number;
	leftFootConfidence?: number;
	rightFootConfidence?: number;
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

function lowestVisibleFootPoint(
	skeleton: Skeleton,
	visibility: JointVisibility,
	feet: FootLandmarks | undefined,
	footVisibility: FootVisibility | undefined,
	side: 'left' | 'right',
): { y: number; confidence: number } {
	const ankle = side === 'left' ? skeleton.leftAnkle : skeleton.rightAnkle;
	const ankleConfidence = conf(visibility, side === 'left' ? 'leftAnkle' : 'rightAnkle');
	const heelName = side === 'left' ? 'leftHeel' : 'rightHeel';
	const toeName = side === 'left' ? 'leftFootIndex' : 'rightFootIndex';
	const heel = feet?.[heelName];
	const heelConfidence = footVisibility?.[heelName] ?? 0;
	const toe = feet?.[toeName];
	const toeConfidence = footVisibility?.[toeName] ?? 0;
	const candidates = [
		{ y: ankle.y, confidence: ankleConfidence },
		...(heel ? [{ y: heel.y, confidence: heelConfidence }] : []),
		...(toe ? [{ y: toe.y, confidence: toeConfidence }] : []),
	].filter(candidate => candidate.confidence >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN);

	// Ankles are part of hasTrackableSquatBody, but keep this defensive fallback
	// for callers that use the metric helper independently.
	if (candidates.length === 0) return { y: ankle.y, confidence: ankleConfidence };
	return candidates.reduce((lowest, candidate) => (candidate.y > lowest.y ? candidate : lowest));
}

// Returns front-camera squat measurements in shoulder-width units where
// practical, keeping the detector independent of the athlete's distance from
// the phone.
export function measureSquat(
	skeleton: Skeleton,
	visibility: JointVisibility,
	feet?: { skeleton: FootLandmarks; visibility: FootVisibility },
): SquatMetrics | null {
	if (!hasTrackableSquatBody(visibility)) return null;

	const width = shoulderWidth(skeleton);
	if (width <= 0) return null;

	const leftKnee = angleAt(skeleton.leftKnee, skeleton.leftHip, skeleton.leftAnkle);
	const rightKnee = angleAt(skeleton.rightKnee, skeleton.rightHip, skeleton.rightAnkle);
	if (leftKnee === null || rightKnee === null) return null;

	const shoulderMid = midpoint(skeleton.leftShoulder, skeleton.rightShoulder);
	const hipMid = midpoint(skeleton.leftHip, skeleton.rightHip);
	const leftFoot = lowestVisibleFootPoint(skeleton, visibility, feet?.skeleton, feet?.visibility, 'left');
	const rightFoot = lowestVisibleFootPoint(skeleton, visibility, feet?.skeleton, feet?.visibility, 'right');
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
		leftFootY: leftFoot.y,
		rightFootY: rightFoot.y,
		leftFootConfidence: leftFoot.confidence,
		rightFootConfidence: rightFoot.confidence,
	};
}
