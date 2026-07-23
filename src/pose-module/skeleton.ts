import { PUSHUP_PARAMS } from './exercises/pushup.config';
import { conf, shoulderWidth } from './geometry';
import { implausibleLegJoints } from './plausibility';
import type { DisplayTier, Joint, JointVisibility, RawPoint, RawPose, Skeleton } from './types';

const P = PUSHUP_PARAMS;

// Confidently in frame this frame -> update the joint's position.
const INFRAME_MARGIN = 0.1;
function isPresent(p: Joint, confidence: number): boolean {
	return (
		confidence >= P.SHOW_CONF &&
		p.x >= -INFRAME_MARGIN &&
		p.x <= 1 + INFRAME_MARGIN &&
		p.y >= -INFRAME_MARGIN &&
		p.y <= 1 + INFRAME_MARGIN
	);
}

// Clearly outside the frame -> the only signal that hides a joint. Low confidence
// while in frame never hides anything (that is what caused the flicker).
const OFFFRAME_MARGIN = 0.18;
function isOffFrame(p: Joint): boolean {
	return (
		p.x < -OFFFRAME_MARGIN ||
		p.x > 1 + OFFFRAME_MARGIN ||
		p.y < -OFFFRAME_MARGIN ||
		p.y > 1 + OFFFRAME_MARGIN
	);
}

// Fixed render-point order. Indices below reference these positions. Head/face
// joints are intentionally absent — the face is never drawn (spec §9.5).
export const RENDER_POINTS: (keyof Skeleton)[] = [
	'leftShoulder', // 0
	'rightShoulder', // 1
	'leftElbow', // 2
	'rightElbow', // 3
	'leftWrist', // 4
	'rightWrist', // 5
	'leftHip', // 6
	'rightHip', // 7
	'leftKnee', // 8
	'rightKnee', // 9
	'leftAnkle', // 10
	'rightAnkle', // 11
];

// Bone index pairs into RENDER_POINTS. CORE = shoulder line + two arm lines
// (the guaranteed minimum, spec §9.3). FULL adds torso + legs.
export const CORE_BONES: [number, number][] = [
	[0, 1],
	[0, 2],
	[2, 4],
	[1, 3],
	[3, 5],
];

export const FULL_BONES: [number, number][] = [
	...CORE_BONES,
	[0, 6],
	[1, 7],
	[6, 7],
	[6, 8],
	[8, 10],
	[7, 9],
	[9, 11],
];

// Replace a side's elbow + wrist with an inferred arm hanging down-and-out from
// the shoulder, so CORE always has a left and right arm line even before the
// elbow/wrist are tracked (spec §9.3). Used only when the real arm is not
// confident; tracked positions take over automatically once confident.
//
// "Outward" is decided in SCREEN space — away from the other shoulder — never
// from the anatomical side label: whether the anatomical left lands on
// screen-left depends on camera mirroring (iOS front camera is unmirrored,
// Android front camera is mirrored), and the side-based sign made both arms
// point inward into a converging triangle on iOS (review Issue 6).
function inferArm(
	pts: RawPoint[],
	s: Skeleton,
	v: JointVisibility,
	elbowIdx: number,
	wristIdx: number,
	shoulder: keyof Skeleton,
	otherShoulder: keyof Skeleton,
	elbow: keyof Skeleton,
	wrist: keyof Skeleton,
): void {
	const armConfident = conf(v, elbow) >= P.EW_MIN && conf(v, wrist) >= P.EW_MIN;
	if (armConfident || conf(v, shoulder) < P.SH_MIN) {
		return; // real arm shown, or no shoulder to anchor an inferred one
	}
	const sw = shoulderWidth(s) || 60;
	const len = P.INFERRED_ARM_LEN * sw;
	// Straight down when the shoulders overlap on screen (side view).
	const dir = Math.sign(s[shoulder].x - s[otherShoulder].x);
	const theta = ((90 - dir * P.OUT_ANGLE_DEG) * Math.PI) / 180; // ~downward, leaning outward
	const base = s[shoulder];
	pts[elbowIdx] = {
		x: base.x + (len / 2) * Math.cos(theta),
		y: base.y + (len / 2) * Math.sin(theta),
		present: true,
		offFrame: false,
		inferred: true,
	};
	pts[wristIdx] = {
		x: base.x + len * Math.cos(theta),
		y: base.y + len * Math.sin(theta),
		present: true,
		offFrame: false,
		inferred: true,
	};
}

// Infer the ankle by extending the shin straight down from the knee (in line with
// the thigh) when the foot is not tracked but the hip + knee are. Gives a steady,
// static lower-leg line instead of a jittery "searching" foot.
function inferLeg(
	pts: RawPoint[],
	s: Skeleton,
	v: JointVisibility,
	ankleIdx: number,
	hip: keyof Skeleton,
	knee: keyof Skeleton,
	ankle: keyof Skeleton,
): void {
	const ankleConfident = conf(v, ankle) >= P.EW_MIN;
	if (ankleConfident || conf(v, knee) < P.SH_MIN || conf(v, hip) < P.SH_MIN) {
		return; // real foot tracked, or no hip/knee to anchor the inferred shin
	}
	const hp = s[hip];
	const kn = s[knee];
	pts[ankleIdx] = {
		x: kn.x + (kn.x - hp.x),
		y: kn.y + (kn.y - hp.y),
		present: true,
		offFrame: false,
		inferred: true,
	};
}

// Build the raw pose (positions + present/offFrame flags). The stabilizer turns
// this into the drawn pose, holding joints through confidence noise. Arms are
// inferred when not yet tracked. NO_BODY produces an empty pose.
export function buildRenderPose(
	s: Skeleton,
	normalized: Skeleton,
	v: JointVisibility,
	tier: DisplayTier,
): RawPose {
	if (tier === 'NO_BODY') {
		return { tier, pts: [] };
	}

	const pts: RawPoint[] = RENDER_POINTS.map(joint => {
		const trustedMin =
			joint === 'leftShoulder' || joint === 'rightShoulder' ? P.SH_MIN : P.EW_MIN;
		return {
			x: s[joint].x,
			y: s[joint].y,
			present: isPresent(normalized[joint], conf(v, joint)),
			offFrame: isOffFrame(normalized[joint]),
			// Drawable but below the trusted threshold — flagged for the issue-5
			// debug glow.
			uncertain: conf(v, joint) < trustedMin,
		};
	});

	// Issue 7: anatomically impossible leg joints are demoted to not-present
	// BEFORE inference, so they enter the hold→fade chain instead of being
	// drawn through the torso. Demotion beats deletion: the stabilizer fades
	// the limb out instead of blinking it off.
	const impossible = implausibleLegJoints(s, v);
	for (const joint of impossible) {
		const idx = RENDER_POINTS.indexOf(joint);
		if (idx >= 0) {
			pts[idx] = { ...pts[idx], present: false, uncertain: true };
		}
	}

	inferArm(pts, s, v, 2, 4, 'leftShoulder', 'rightShoulder', 'leftElbow', 'leftWrist');
	inferArm(pts, s, v, 3, 5, 'rightShoulder', 'leftShoulder', 'rightElbow', 'rightWrist');
	// Never anchor an inferred shin on a knee that was just ruled impossible.
	if (!impossible.has('leftKnee')) {
		inferLeg(pts, s, v, 10, 'leftHip', 'leftKnee', 'leftAnkle');
	}
	if (!impossible.has('rightKnee')) {
		inferLeg(pts, s, v, 11, 'rightHip', 'rightKnee', 'rightAnkle');
	}

	return { tier, pts };
}
