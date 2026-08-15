import { angleAt, conf, dist, midpoint, shoulderWidth, worldShoulderWidth } from '../geometry';
import { SQUAT_PARAMS } from '../exercises/squat.config';
import type { FootLandmarks, FootVisibility, JointVisibility, Skeleton, WorldSkeleton } from '../types';

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
	// Normal Squats require an upright, standing-scale lower body. This rejects
	// kneeling/plank poses whose knee bend can otherwise resemble a squat.
	isUpright?: boolean;
	verticalAnkleSpanSW?: number;
	// Lowest confidently visible point on each foot. These fall back to the
	// ankle on frames from older bridges/tests, but use heel/toe landmarks on
	// current MediaPipe frames so a single jittery ankle cannot decide a jump.
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

export function hasTrackableSquatBody(visibility: JointVisibility, allowSingleSide = false): boolean {
	if (!allowSingleSide) {
		return REQUIRED_JOINTS.every(joint => conf(visibility, joint) >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN);
	}

	const sideIsTrackable = (side: 'left' | 'right') =>
		conf(visibility, `${side}Shoulder`) >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN &&
		conf(visibility, `${side}Hip`) >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN &&
		conf(visibility, `${side}Knee`) >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN &&
		conf(visibility, `${side}Ankle`) >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN;
	return sideIsTrackable('left') || sideIsTrackable('right');
}

export interface SquatMeasurementOptions {
	// Side-view exercise videos often occlude the rear leg. Jump Squats can use
	// the visible leg plus pelvis motion; side steps still require both legs.
	allowSingleSide?: boolean;
	world?: WorldSkeleton;
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
	options: SquatMeasurementOptions = {},
): SquatMetrics | null {
	const allowSingleSide = options.allowSingleSide ?? false;
	if (!hasTrackableSquatBody(visibility, allowSingleSide)) return null;

	const jointCenter = (left: keyof Skeleton, right: keyof Skeleton) => {
		const leftVisible = conf(visibility, left) >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN;
		const rightVisible = conf(visibility, right) >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN;
		if (leftVisible && rightVisible) return midpoint(skeleton[left], skeleton[right]);
		if (leftVisible) return skeleton[left];
		if (rightVisible) return skeleton[right];
		return midpoint(skeleton[left], skeleton[right]);
	};
	const sideKneeAngle = (side: 'left' | 'right'): number | null => {
		if (
			allowSingleSide &&
			(conf(visibility, `${side}Hip`) < SQUAT_PARAMS.JOINT_CONFIDENCE_MIN ||
				conf(visibility, `${side}Knee`) < SQUAT_PARAMS.JOINT_CONFIDENCE_MIN ||
				conf(visibility, `${side}Ankle`) < SQUAT_PARAMS.JOINT_CONFIDENCE_MIN)
		) {
			return null;
		}
		return angleAt(skeleton[`${side}Knee`], skeleton[`${side}Hip`], skeleton[`${side}Ankle`]);
	};
	const kneeAngles = [sideKneeAngle('left'), sideKneeAngle('right')].filter(
		(angle): angle is number => angle !== null,
	);
	if (kneeAngles.length === 0) return null;

	const shoulderMid = jointCenter('leftShoulder', 'rightShoulder');
	const hipMid = jointCenter('leftHip', 'rightHip');
	const bothShouldersVisible =
		conf(visibility, 'leftShoulder') >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN &&
		conf(visibility, 'rightShoulder') >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN;
	const bothHipsVisible =
		conf(visibility, 'leftHip') >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN &&
		conf(visibility, 'rightHip') >= SQUAT_PARAMS.JOINT_CONFIDENCE_MIN;
	const frontWidth = !allowSingleSide || bothShouldersVisible ? shoulderWidth(skeleton) : 0;
	const torsoScale = dist(shoulderMid, hipMid) * 0.45;
	const hipWidth = bothHipsVisible ? dist(skeleton.leftHip, skeleton.rightHip) * 1.15 : 0;
	// Shoulder span collapses in a side view. A torso-derived floor keeps jump
	// normalization stable without changing ordinary front-view scale.
	const width = allowSingleSide ? Math.max(frontWidth, hipWidth, torsoScale) : frontWidth;
	if (width <= 0) return null;
	const estimatedShoulderWidthM = options.world ? worldShoulderWidth(options.world) : undefined;
	const leftFoot = lowestVisibleFootPoint(skeleton, visibility, feet?.skeleton, feet?.visibility, 'left');
	const rightFoot = lowestVisibleFootPoint(skeleton, visibility, feet?.skeleton, feet?.visibility, 'right');
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
		stanceWidth: Math.abs(skeleton.leftAnkle.x - skeleton.rightAnkle.x) / width,
		pelvisY: hipMid.y,
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
		leftFootY: leftFoot.y,
		rightFootY: rightFoot.y,
		leftFootConfidence: Math.min(leftFoot.confidence, legConfidence('left')),
		rightFootConfidence: Math.min(rightFoot.confidence, legConfidence('right')),
		...(estimatedShoulderWidthM && Number.isFinite(estimatedShoulderWidthM)
			? { estimatedShoulderWidthM }
			: {}),
	};
}
