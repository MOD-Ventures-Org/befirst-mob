import { PUSHUP_PARAMS } from './exercises/pushup.config';
import { conf, shoulderWidth } from './geometry';
import type { JointVisibility, Skeleton } from './types';

const P = PUSHUP_PARAMS;

// Joints listed in the debug checklist's "All visible" row (diagnostics only).
export const STANDING_JOINTS: (keyof Skeleton)[] = [
	'nose',
	'leftShoulder',
	'rightShoulder',
	'leftHip',
	'rightHip',
	'leftKnee',
	'rightKnee',
	'leftAnkle',
	'rightAnkle',
	'leftWrist',
	'rightWrist',
];

// Inside-frame check on raw normalized coords ([0,1] in sensor space) — edge
// proximity survives the sensor→view rotation, unlike axis-specific checks.
export function insideFrame(n: Skeleton, joint: keyof Skeleton): boolean {
	const { x, y } = n[joint];
	const m = P.FRAME_MARGIN;
	return x >= m && x <= 1 - m && y >= m && y <= 1 - m;
}

// Body extent as a fraction of the frame, measured on the normalized bbox of
// the given joints. The max of width/height is used so the measure does not
// care which sensor axis is vertical after rotation.
export function bodyExtent(n: Skeleton, joints: (keyof Skeleton)[]): number {
	const xs = joints.map(j => n[j].x);
	const ys = joints.map(j => n[j].y);
	const w = Math.max(...xs) - Math.min(...xs);
	const h = Math.max(...ys) - Math.min(...ys);
	return Math.max(w, h);
}

/**
 * "Body is upright / vertically extended" — the view-independent standing
 * signal. The counter's only guard: while true, rep-like depth swings are
 * standing/walking motion and must not count.
 *
 * Torso angle CANNOT be used here: with the phone on the floor facing the
 * athlete (the doc 10.2 setup), a plank torso points into the frame and
 * projects near-vertically — the field test showed spine ≈ 0–5° during real
 * push-ups. What does separate the poses in every view is the vertical leg
 * span below the shoulders: standing puts confident ankles ~5–7 shoulder
 * widths below the shoulders; a plank (head-on or side view) compresses that
 * span to ~1–2. Knees serve as the fallback when ankles are not tracked.
 * With no confident lower body there is no verdict (returns false) — the
 * strict full-body Ready Check still owns session entry.
 */
export function isUprightExtended(s: Skeleton, v: JointVisibility): boolean {
	if (conf(v, 'leftShoulder') < P.SH_MIN || conf(v, 'rightShoulder') < P.SH_MIN) {
		return false;
	}
	const width = shoulderWidth(s);
	if (width <= 0) return false;
	const shoulderMidY = (s.leftShoulder.y + s.rightShoulder.y) / 2;

	const ankleYs: number[] = [];
	if (conf(v, 'leftAnkle') >= P.EW_MIN) ankleYs.push(s.leftAnkle.y);
	if (conf(v, 'rightAnkle') >= P.EW_MIN) ankleYs.push(s.rightAnkle.y);
	if (ankleYs.length > 0) {
		if ((Math.max(...ankleYs) - shoulderMidY) / width >= P.UPRIGHT_ANKLE_SPAN_SW) {
			return true;
		}
	}

	const kneeYs: number[] = [];
	if (conf(v, 'leftKnee') >= P.EW_MIN) kneeYs.push(s.leftKnee.y);
	if (conf(v, 'rightKnee') >= P.EW_MIN) kneeYs.push(s.rightKnee.y);
	if (kneeYs.length > 0) {
		if ((Math.max(...kneeYs) - shoulderMidY) / width >= P.UPRIGHT_KNEE_SPAN_SW) {
			return true;
		}
	}

	return false;
}
