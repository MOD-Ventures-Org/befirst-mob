import { PUSHUP_PARAMS } from './exercises/pushup.config';
import { conf, dist, shoulderWidth } from './geometry';
import type { DisplayTier, JointVisibility, PoseFrame, Skeleton } from './types';

const P = PUSHUP_PARAMS;

const FACE_JOINTS: (keyof Skeleton)[] = ['nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar'];
const ALL_JOINTS: (keyof Skeleton)[] = [
	'nose',
	'leftShoulder',
	'rightShoulder',
	'leftElbow',
	'rightElbow',
	'leftWrist',
	'rightWrist',
	'leftHip',
	'rightHip',
	'leftKnee',
	'rightKnee',
	'leftAnkle',
	'rightAnkle',
];

function ratioInRange(r: number, min: number, max: number): boolean {
	return Number.isFinite(r) && r >= min && r <= max;
}

function facePresent(v: JointVisibility): boolean {
	return FACE_JOINTS.some(j => conf(v, j) >= 0.5);
}

export function shouldersPresent(v: JointVisibility): boolean {
	return conf(v, 'leftShoulder') >= P.DRAW_BODY_MIN || conf(v, 'rightShoulder') >= P.DRAW_BODY_MIN;
}

function bothShouldersPresent(v: JointVisibility): boolean {
	return conf(v, 'leftShoulder') >= P.SH_MIN && conf(v, 'rightShoulder') >= P.SH_MIN;
}

// Bounding box of confident landmarks, as a fraction of the (normalized) frame.
function bboxCoverage(n: Skeleton, v: JointVisibility): number {
	const pts = ALL_JOINTS.filter(j => conf(v, j) >= 0.5).map(j => n[j]);
	if (pts.length < 3) return 0;
	const xs = pts.map(p => p.x);
	const ys = pts.map(p => p.y);
	const w = Math.min(1, Math.max(...xs)) - Math.max(0, Math.min(...xs));
	const h = Math.min(1, Math.max(...ys)) - Math.max(0, Math.min(...ys));
	return Math.max(0, w) * Math.max(0, h);
}

// spec §9.2
export function tooClose(frame: PoseFrame): boolean {
	const { normalized: n, visibility: v } = frame;
	// Face framed but shoulders missing → only the head is in view.
	if (facePresent(v) && !shouldersPresent(v)) return true;
	// Shoulders span too large a fraction of the frame.
	if (bothShouldersPresent(v) && dist(n.leftShoulder, n.rightShoulder) > P.TOO_CLOSE_SHOULDER_W) {
		return true;
	}
	// Everything confident fills almost the whole frame.
	if (bboxCoverage(n, v) > P.TOO_CLOSE_BBOX) return true;
	return false;
}

// spec §9.4 — only the CONFIDENT bones are checked; a confident bone that is the
// wrong length vs shoulder width (or wildly asymmetric) means the skeleton is
// scattered/garbage and must be hidden. Low-confidence bones are not judged
// (they simply will not be drawn).
export function anatomicallyPlausible(s: Skeleton, v: JointVisibility): boolean {
	const sw = shoulderWidth(s);
	if (!Number.isFinite(sw) || sw <= 0) return false;

	const sideOk = (
		shoulder: keyof Skeleton,
		elbow: keyof Skeleton,
		wrist: keyof Skeleton,
	): boolean => {
		if (conf(v, shoulder) >= P.SH_MIN && conf(v, elbow) >= P.EW_MIN) {
			if (!ratioInRange(dist(s[shoulder], s[elbow]) / sw, P.UPPER_ARM_MIN, P.UPPER_ARM_MAX)) {
				return false;
			}
		}
		if (conf(v, elbow) >= P.EW_MIN && conf(v, wrist) >= P.EW_MIN) {
			if (!ratioInRange(dist(s[elbow], s[wrist]) / sw, P.FOREARM_MIN, P.FOREARM_MAX)) {
				return false;
			}
		}
		return true;
	};

	if (!sideOk('leftShoulder', 'leftElbow', 'leftWrist')) return false;
	if (!sideOk('rightShoulder', 'rightElbow', 'rightWrist')) return false;

	// Symmetry only when both upper arms are confident.
	const lUpper = dist(s.leftShoulder, s.leftElbow);
	const rUpper = dist(s.rightShoulder, s.rightElbow);
	if (
		conf(v, 'leftElbow') >= P.EW_MIN &&
		conf(v, 'rightElbow') >= P.EW_MIN &&
		rUpper > 0 &&
		!ratioInRange(lUpper / rUpper, P.SYM_MIN, P.SYM_MAX)
	) {
		return false;
	}

	return true;
}

// --- Issue 7: per-leg plausibility -----------------------------------------

interface Pt {
	x: number;
	y: number;
}

// Ray-cast point-in-polygon (even-odd). Polygon given as an ordered ring.
function pointInPolygon(p: Pt, ring: Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i];
		const b = ring[j];
		const crosses =
			a.y > p.y !== b.y > p.y &&
			p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
		if (crosses) inside = !inside;
	}
	return inside;
}

// Torso polygon (both shoulders + both hips), shrunk toward its centroid so
// borderline joints at the torso edge are not rejected.
function torsoQuad(s: Skeleton, v: JointVisibility): Pt[] | null {
	const joints: (keyof Skeleton)[] = ['leftShoulder', 'rightShoulder', 'rightHip', 'leftHip'];
	for (const j of joints) {
		if (conf(v, j) < P.SH_MIN) return null; // can't judge occlusion without a torso
	}
	const ring = joints.map(j => ({ x: s[j].x, y: s[j].y }));
	const cx = ring.reduce((a, p) => a + p.x, 0) / 4;
	const cy = ring.reduce((a, p) => a + p.y, 0) / 4;
	const k = P.TORSO_QUAD_SHRINK;
	return ring.map(p => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

/**
 * Joints of a leg that are anatomically impossible this frame (issue 7):
 *  - a confidently-detected knee/ankle lying INSIDE the torso polygon — a leg
 *    drawn through the body while the torso occludes it;
 *  - thigh/shin bone lengths far outside human proportion vs shoulder width.
 *
 * Returned joints are demoted to not-present by the caller, which routes them
 * into the issue-4 chain: hold briefly, then fade — never blink, never draw
 * the impossible configuration. Only confident joints are ever judged; a
 * low-confidence leg is already handled by the confidence pipeline.
 */
export function implausibleLegJoints(s: Skeleton, v: JointVisibility): Set<keyof Skeleton> {
	const out = new Set<keyof Skeleton>();
	const sw = shoulderWidth(s);
	if (!Number.isFinite(sw) || sw <= 0) return out;

	const quad = torsoQuad(s, v);

	const judgeSide = (hip: keyof Skeleton, knee: keyof Skeleton, ankle: keyof Skeleton): void => {
		const kneeConf = conf(v, knee) >= P.EW_MIN;
		const ankleConf = conf(v, ankle) >= P.EW_MIN;

		// Leg-through-torso: the torso occludes that space; a limb drawn there
		// is impossible in any pose the camera can actually see.
		if (quad) {
			if (kneeConf && pointInPolygon(s[knee], quad)) out.add(knee);
			if (ankleConf && pointInPolygon(s[ankle], quad)) out.add(ankle);
		}

		// Impossible bone lengths (vs shoulder width).
		if (conf(v, hip) >= P.SH_MIN && kneeConf) {
			const thigh = dist(s[hip], s[knee]) / sw;
			if (thigh < P.THIGH_MIN || thigh > P.THIGH_MAX) out.add(knee);
		}
		if (kneeConf && ankleConf) {
			const shin = dist(s[knee], s[ankle]) / sw;
			if (shin < P.SHIN_MIN || shin > P.SHIN_MAX) out.add(ankle);
		}

		// A demoted knee orphans its shin — the ankle line would hang in space.
		if (out.has(knee)) out.add(ankle);
	};

	judgeSide('leftHip', 'leftKnee', 'leftAnkle');
	judgeSide('rightHip', 'rightKnee', 'rightAnkle');
	return out;
}

// Draw whenever at least one shoulder is present and the (confident) skeleton is
// anatomically plausible. We always attempt the full skeleton; each bone is then
// drawn per-endpoint based on whether the joint is in frame (see buildRenderPose),
// so close-ups show the upper body and far shots show the legs too. NO_BODY hides
// everything — used only when no shoulder is tracked or the skeleton is scattered.
// `tooClose` no longer blanks the overlay; it only drives the coaching hint.
export function displayTier(frame: PoseFrame): DisplayTier {
	const { skeleton: s, visibility: v } = frame;
	if (!shouldersPresent(v)) return 'NO_BODY';
	if (!anatomicallyPlausible(s, v)) return 'NO_BODY';
	return 'FULL';
}
