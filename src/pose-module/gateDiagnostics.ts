import { PUSHUP_PARAMS } from './exercises/pushup.config';
import { conf, fusedElbowAngle, shoulderWidth } from './geometry';
import { anatomicallyPlausible, shouldersPresent, tooClose } from './plausibility';
import { bodyExtent, insideFrame, isUprightExtended, STANDING_JOINTS } from './posture';
import type { JointAngles, PoseFrame, Skeleton } from './types';

const P = PUSHUP_PARAMS;

// One row of the on-screen debug checklist. `ok` means the condition is in the
// desired state (e.g. "Person is standing: No" is ok for a push-up set).
export interface GateCheck {
	label: string;
	value: string;
	ok: boolean;
}

export interface GateDiagnosticsInput {
	plankish: boolean;
	depth: number | null;
	wristsTraveling: boolean;
}

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

const standingChecks = (frame: PoseFrame, angles: JointAngles): GateCheck[] => {
	const { skeleton: s, normalized: n, visibility: v } = frame;

	const confidences = STANDING_JOINTS.map(joint => conf(v, joint));
	const allTracked = confidences.every(value => value >= P.STAND_CONF_MIN);
	const allInside = STANDING_JOINTS.every(joint => insideFrame(n, joint));
	const allVisible = allTracked && allInside;
	const minConf = Math.min(...confidences);

	const extent = bodyExtent(n, STANDING_JOINTS);
	const distanceOk = extent >= P.STAND_HEIGHT_MIN && extent <= P.STAND_HEIGHT_MAX;

	const torsoOk = angles.spine <= P.STAND_TORSO_MAX_DEG;

	const legsDown = isUprightExtended(s, v);

	const shoulderY = Math.max(s.leftShoulder.y, s.rightShoulder.y);
	const hipTopY = Math.min(s.leftHip.y, s.rightHip.y);
	const hipBottomY = Math.max(s.leftHip.y, s.rightHip.y);
	const kneeTopY = Math.min(s.leftKnee.y, s.rightKnee.y);
	const kneeBottomY = Math.max(s.leftKnee.y, s.rightKnee.y);
	const ankleTopY = Math.min(s.leftAnkle.y, s.rightAnkle.y);
	const orderingOk =
		s.nose.y < Math.min(s.leftShoulder.y, s.rightShoulder.y) &&
		shoulderY < hipTopY &&
		hipBottomY < kneeTopY &&
		kneeBottomY < ankleTopY;

	return [
		{ label: 'All visible', value: `${yesNo(allVisible)} (min ${minConf.toFixed(2)})`, ok: allVisible },
		{
			label: 'Distance (correct)',
			value: `${Math.round(extent * 100)}% (need 50-85%)`,
			ok: distanceOk,
		},
		{ label: 'Torso (correct)', value: `${Math.round(angles.spine)}° (need ≤20°)`, ok: torsoOk },
		{ label: 'Legs (downwards)', value: yesNo(legsDown), ok: legsDown },
		{ label: 'Joint ordering', value: yesNo(orderingOk), ok: orderingOk },
	];
};

const sideOrdered = (s: Skeleton, v: PoseFrame['visibility'], side: 'left' | 'right'): boolean => {
	const shoulder = side === 'left' ? s.leftShoulder : s.rightShoulder;
	const elbow = side === 'left' ? s.leftElbow : s.rightElbow;
	const wrist = side === 'left' ? s.leftWrist : s.rightWrist;
	if (conf(v, side === 'left' ? 'leftElbow' : 'rightElbow') < P.EW_MIN) return true;
	return wrist.y > elbow.y && elbow.y > shoulder.y;
};

const topPositionChecks = (frame: PoseFrame): GateCheck[] => {
	const { skeleton: s, normalized: n, visibility: v } = frame;

	const standing = isUprightExtended(s, v);

	const elbow = fusedElbowAngle(s, v);
	const armsOk = elbow !== null && elbow >= P.ARM_EXTENDED_DEG;

	const wristsOk =
		conf(v, 'leftWrist') >= P.EW_MIN &&
		conf(v, 'rightWrist') >= P.EW_MIN &&
		insideFrame(n, 'leftWrist') &&
		insideFrame(n, 'rightWrist');

	const orderingOk = sideOrdered(s, v, 'left') && sideOrdered(s, v, 'right');

	const width = shoulderWidth(s);
	const leftOffset = width > 0 ? Math.abs(s.leftWrist.x - s.leftShoulder.x) / width : Infinity;
	const rightOffset = width > 0 ? Math.abs(s.rightWrist.x - s.rightShoulder.x) / width : Infinity;
	const maxOffset = Math.max(leftOffset, rightOffset);
	const handsOk = maxOffset <= P.HANDS_UNDER_SHOULDERS_TOL;

	return [
		{ label: 'Person is standing', value: yesNo(standing), ok: !standing },
		{
			label: 'Arms extended',
			value: `${elbow === null ? '—' : `${Math.round(elbow)}°`} (need ≥${P.ARM_EXTENDED_DEG}°)`,
			ok: armsOk,
		},
		{ label: 'Wrists in frame', value: yesNo(wristsOk), ok: wristsOk },
		{ label: 'Vertical ordering', value: yesNo(orderingOk), ok: orderingOk },
		{
			label: 'Hands under shoulders',
			value: `${Number.isFinite(maxOffset) ? `${maxOffset.toFixed(2)}×SW` : '—'} (need ≤${P.HANDS_UNDER_SHOULDERS_TOL})`,
			ok: handsOk,
		},
	];
};

const signalChecks = (frame: PoseFrame, input: GateDiagnosticsInput): GateCheck[] => {
	const { skeleton: s, visibility: v } = frame;
	const shouldersOk = shouldersPresent(v);
	const close = tooClose(frame);
	const plausible = anatomicallyPlausible(s, v);
	const depthText = input.depth === null ? '—' : input.depth.toFixed(2);

	return [
		{ label: 'Shoulders tracked', value: yesNo(shouldersOk), ok: shouldersOk },
		{ label: 'Too close', value: yesNo(close), ok: !close },
		{ label: 'Skeleton plausible', value: yesNo(plausible), ok: plausible },
		{
			label: 'Plank depth',
			value: `${depthText} (need >${P.PLANK_DEPTH_MIN})`,
			ok: input.plankish,
		},
		{ label: 'Hands planted', value: yesNo(!input.wristsTraveling), ok: !input.wristsTraveling },
	];
};

/**
 * Live per-condition breakdown for the on-screen debug checklist: the standing
 * pose conditions, the top push-up-position conditions, and the counting-signal
 * guards. Diagnostics only — counting has no readiness gate anymore; the only
 * live guard is the upright veto (mirrored by "Person is standing").
 */
export function computeGateDiagnostics(
	frame: PoseFrame,
	angles: JointAngles,
	input: GateDiagnosticsInput,
): { standing: GateCheck[]; arming: GateCheck[]; signal: GateCheck[] } {
	return {
		standing: standingChecks(frame, angles),
		arming: topPositionChecks(frame),
		signal: signalChecks(frame, input),
	};
}

export type GateDiagnostics = ReturnType<typeof computeGateDiagnostics>;
