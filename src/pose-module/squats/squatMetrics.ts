import { angleAt, conf, dist, midpoint, shoulderWidth, worldShoulderWidth } from '../geometry';
import { SQUAT_PARAMS } from '../exercises/squat.config';
import type { FootLandmarks, FootVisibility, JointVisibility, Skeleton, WorldSkeleton } from '../types';

export interface SquatMetrics {
	kneeAngle: number;
	// Kept separately as well as averaged. Standard squats require both knees
	// to pass the phase threshold; otherwise lifting one leg can make the mean
	// angle look like a squat while the support leg remains straight.
	leftKneeAngle?: number;
	rightKneeAngle?: number;
	stanceWidth: number;
	// Present on measurements produced by measureSquat. Optionality preserves
	// compatibility with older integrations and hand-authored detector fixtures.
	pelvisX?: number;
	pelvisY: number;
	leftHipY?: number;
	rightHipY?: number;
	ankleY: number;
	leftAnkleY: number;
	rightAnkleY: number;
	leftAnkleX: number;
	rightAnkleX: number;
	shoulderWidth: number;
	torsoLean: number;
	// Normal Squats require an upright, standing-scale lower body. This rejects
	// kneeling/plank poses whose knee bend can otherwise resemble a squat.
	isUpright?: boolean;
	verticalAnkleSpanSW?: number;
	// Lowest confidently visible point on each foot. These fall back to the
	// ankle on frames from older bridges/tests, but use heel/toe landmarks on
	// current MediaPipe frames so a single jittery ankle cannot decide a jump.
	leftFootX?: number;
	rightFootX?: number;
	leftFootY?: number;
	rightFootY?: number;
	leftFootConfidence?: number;
	rightFootConfidence?: number;
	// Optional metric scale from MediaPipe world landmarks. The detector keeps
	// shoulder-width units as the source of truth and uses this only to show an
	// approximate centimetre value.
	estimatedShoulderWidthM?: number;
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

export type SquatFramingWarning = 'knees-not-visible' | 'too-close' | 'too-far' | null;

export function hasTrackableSquatBody(
	visibility: JointVisibility,
	allowSingleSide = false,
	minimumConfidence: number = SQUAT_PARAMS.JOINT_CONFIDENCE_MIN,
): boolean {
	if (!allowSingleSide) {
		return REQUIRED_JOINTS.every(joint => conf(visibility, joint) >= minimumConfidence);
	}

	const sideIsTrackable = (side: 'left' | 'right') =>
		conf(visibility, `${side}Shoulder`) >= minimumConfidence &&
		conf(visibility, `${side}Hip`) >= minimumConfidence &&
		conf(visibility, `${side}Knee`) >= minimumConfidence &&
		conf(visibility, `${side}Ankle`) >= minimumConfidence;
	return sideIsTrackable('left') || sideIsTrackable('right');
}

/**
 * Confidence alone is not proof that a body is inside the camera image:
 * MediaPipe can keep returning confident, extrapolated joints for a few frames
 * as someone walks out. This spatial gate is intentionally separate from the
 * advisory size warning because crossing an image edge must cancel counting.
 */
export function isSquatBodyInFrame(
	normalized: Skeleton,
	visibility: JointVisibility,
	allowSingleSide = false,
	minimumConfidence: number = SQUAT_PARAMS.JOINT_CONFIDENCE_MIN,
): boolean {
	const margin = SQUAT_PARAMS.BODY_FRAME_EDGE_MARGIN;
	const jointIsInside = (joint: keyof Skeleton) => {
		const point = normalized[joint];
		return (
			conf(visibility, joint) >= minimumConfidence &&
			Number.isFinite(point.x) &&
			Number.isFinite(point.y) &&
			point.x >= margin &&
			point.x <= 1 - margin &&
			point.y >= margin &&
			point.y <= 1 - margin
		);
	};

	if (!allowSingleSide) return REQUIRED_JOINTS.every(jointIsInside);
	const sideIsInside = (side: 'left' | 'right') =>
		([`${side}Shoulder`, `${side}Hip`, `${side}Knee`, `${side}Ankle`] as (keyof Skeleton)[]).every(jointIsInside);
	return sideIsInside('left') || sideIsInside('right');
}

// The normalised camera coordinates retain the full [0, 1] frame regardless
// of preview size. Using the longest body dimension keeps the warning valid if
// a camera reports its sensor axes rotated; it is intentionally advisory and
// never gates a repetition.
export function squatFramingWarning(normalized: Skeleton, visibility: JointVisibility): SquatFramingWarning {
	const kneesVisible =
		conf(visibility, 'leftKnee') >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN &&
		conf(visibility, 'rightKnee') >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN;
	if (!kneesVisible) return 'knees-not-visible';
	if (!hasTrackableSquatBody(visibility)) return null;
	const xs = REQUIRED_JOINTS.map(joint => normalized[joint].x);
	const ys = REQUIRED_JOINTS.map(joint => normalized[joint].y);
	const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

	if (span >= SQUAT_PARAMS.MAX_BODY_FRAME_SPAN) return 'too-close';
	if (span < SQUAT_PARAMS.MIN_BODY_FRAME_SPAN) return 'too-far';
	return null;
}

export interface SquatMeasurementOptions {
	// Side-view exercise videos often occlude the rear leg. Jump Squats can use
	// the visible leg plus pelvis motion; side steps still require both legs.
	allowSingleSide?: boolean;
	minimumConfidence?: number;
	world?: WorldSkeleton;
}

function lowestVisibleFootPoint(
	skeleton: Skeleton,
	visibility: JointVisibility,
	feet: FootLandmarks | undefined,
	footVisibility: FootVisibility | undefined,
	side: 'left' | 'right',
	minimumConfidence: number,
): { x: number; y: number; confidence: number } {
	const ankle = side === 'left' ? skeleton.leftAnkle : skeleton.rightAnkle;
	const ankleConfidence = conf(visibility, side === 'left' ? 'leftAnkle' : 'rightAnkle');
	const heelName = side === 'left' ? 'leftHeel' : 'rightHeel';
	const toeName = side === 'left' ? 'leftFootIndex' : 'rightFootIndex';
	const heel = feet?.[heelName];
	const heelConfidence = footVisibility?.[heelName] ?? 0;
	const toe = feet?.[toeName];
	const toeConfidence = footVisibility?.[toeName] ?? 0;
	const candidates = [
		{ x: ankle.x, y: ankle.y, confidence: ankleConfidence },
		...(heel ? [{ x: heel.x, y: heel.y, confidence: heelConfidence }] : []),
		...(toe ? [{ x: toe.x, y: toe.y, confidence: toeConfidence }] : []),
	].filter(candidate => candidate.confidence >= minimumConfidence);

	// Ankles are part of hasTrackableSquatBody, but keep this defensive fallback
	// for callers that use the metric helper independently.
	if (candidates.length === 0) return { x: ankle.x, y: ankle.y, confidence: ankleConfidence };
	return candidates.reduce((lowest, candidate) => (candidate.y > lowest.y ? candidate : lowest));
}

// Returns front-camera squat measurements in shoulder-width units where
// practical, keeping the detector independent of the athlete's distance from
// the phone.
export function measureSquat(
	skeleton: Skeleton,
	visibility: JointVisibility,
	feet?: { skeleton: FootLandmarks; visibility: FootVisibility },
	options: SquatMeasurementOptions = {},
): SquatMetrics | null {
	const allowSingleSide = options.allowSingleSide ?? false;
	const minimumConfidence = options.minimumConfidence ?? SQUAT_PARAMS.JOINT_CONFIDENCE_MIN;
	if (!hasTrackableSquatBody(visibility, allowSingleSide, minimumConfidence)) return null;

	const jointCenter = (left: keyof Skeleton, right: keyof Skeleton) => {
		const leftVisible = conf(visibility, left) >= minimumConfidence;
		const rightVisible = conf(visibility, right) >= minimumConfidence;
		if (leftVisible && rightVisible) return midpoint(skeleton[left], skeleton[right]);
		if (leftVisible) return skeleton[left];
		if (rightVisible) return skeleton[right];
		return midpoint(skeleton[left], skeleton[right]);
	};
	const sideKneeAngle = (side: 'left' | 'right'): number | null => {
		if (
			conf(visibility, `${side}Hip`) < minimumConfidence ||
			conf(visibility, `${side}Knee`) < minimumConfidence ||
			conf(visibility, `${side}Ankle`) < minimumConfidence
		) {
			return null;
		}
		const angle = angleAt(skeleton[`${side}Knee`], skeleton[`${side}Hip`], skeleton[`${side}Ankle`]);
		return angle !== null && Number.isFinite(angle) ? angle : null;
	};
	const leftKneeAngle = sideKneeAngle('left');
	const rightKneeAngle = sideKneeAngle('right');
	// Standard Squats must never turn a single valid knee into bilateral
	// evidence. Side-view Jump Squats explicitly opt into the one-side path.
	if (!allowSingleSide && (leftKneeAngle === null || rightKneeAngle === null)) return null;
	const kneeAngles = [leftKneeAngle, rightKneeAngle].filter(
		(angle): angle is number => angle !== null,
	);
	if (kneeAngles.length === 0) return null;

	const shoulderMid = jointCenter('leftShoulder', 'rightShoulder');
	const hipMid = jointCenter('leftHip', 'rightHip');
	const bothShouldersVisible =
		conf(visibility, 'leftShoulder') >= minimumConfidence &&
		conf(visibility, 'rightShoulder') >= minimumConfidence;
	const bothHipsVisible =
		conf(visibility, 'leftHip') >= minimumConfidence &&
		conf(visibility, 'rightHip') >= minimumConfidence;
	const frontWidth = !allowSingleSide || bothShouldersVisible ? shoulderWidth(skeleton) : 0;
	const torsoScale = dist(shoulderMid, hipMid) * 0.45;
	const hipWidth = bothHipsVisible ? dist(skeleton.leftHip, skeleton.rightHip) * 1.15 : 0;
	// Shoulder span collapses in a side view. A torso-derived floor keeps jump
	// normalization stable without changing ordinary front-view scale.
	const width = allowSingleSide ? Math.max(frontWidth, hipWidth, torsoScale) : frontWidth;
	if (!Number.isFinite(width) || width <= 0) return null;
	const estimatedShoulderWidthM = options.world ? worldShoulderWidth(options.world) : undefined;
	const leftFoot = lowestVisibleFootPoint(
		skeleton,
		visibility,
		feet?.skeleton,
		feet?.visibility,
		'left',
		minimumConfidence,
	);
	const rightFoot = lowestVisibleFootPoint(
		skeleton,
		visibility,
		feet?.skeleton,
		feet?.visibility,
		'right',
		minimumConfidence,
	);
	const legConfidence = (side: 'left' | 'right') =>
		Math.min(
			conf(visibility, `${side}Hip`),
			conf(visibility, `${side}Knee`),
			conf(visibility, `${side}Ankle`),
		);
	const torsoLean = Math.abs((Math.atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y) * 180) / Math.PI);
	const verticalAnkleSpanSW =
		((skeleton.leftAnkle.y + skeleton.rightAnkle.y) / 2 - shoulderMid.y) / width;

	return {
		kneeAngle: kneeAngles.reduce((total, angle) => total + angle, 0) / kneeAngles.length,
		...(leftKneeAngle !== null ? { leftKneeAngle } : {}),
		...(rightKneeAngle !== null ? { rightKneeAngle } : {}),
		stanceWidth: Math.abs(skeleton.leftAnkle.x - skeleton.rightAnkle.x) / width,
		pelvisX: hipMid.x,
		pelvisY: hipMid.y,
		leftHipY: skeleton.leftHip.y,
		rightHipY: skeleton.rightHip.y,
		ankleY: (skeleton.leftAnkle.y + skeleton.rightAnkle.y) / 2,
		leftAnkleY: skeleton.leftAnkle.y,
		rightAnkleY: skeleton.rightAnkle.y,
		leftAnkleX: skeleton.leftAnkle.x,
		rightAnkleX: skeleton.rightAnkle.x,
		shoulderWidth: width,
		torsoLean,
		verticalAnkleSpanSW,
		// Jump Squats deliberately support a side view, where projected vertical
		// body span is not a reliable standing test. The normal-squat detector
		// applies this gate; jump mode ignores it.
		isUpright: verticalAnkleSpanSW >= SQUAT_PARAMS.MIN_UPRIGHT_ANKLE_SPAN_SW,
		leftFootX: leftFoot.x,
		rightFootX: rightFoot.x,
		leftFootY: leftFoot.y,
		rightFootY: rightFoot.y,
		leftFootConfidence: Math.min(leftFoot.confidence, legConfidence('left')),
		rightFootConfidence: Math.min(rightFoot.confidence, legConfidence('right')),
		...(estimatedShoulderWidthM && Number.isFinite(estimatedShoulderWidthM)
			? { estimatedShoulderWidthM }
			: {}),
	};
}
