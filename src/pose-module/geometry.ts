import { PUSHUP_PARAMS } from './exercises/pushup.config';
import type { Joint, JointVisibility, Skeleton, WorldJoint, WorldSkeleton } from './types';

// Confidence accessor (MediaPipe visibility/presence). Falls back to 0.
export function conf(visibility: JointVisibility, joint: keyof Skeleton): number {
	return visibility[joint] ?? 0;
}

export function dist(a: Joint, b: Joint): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Joint, b: Joint): Joint {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Angle (degrees) at `vertex`, formed by segments vertex→a and vertex→c.
// Scale-invariant, so it is the same in normalized or view (square-pixel) space.
export function angleAt(vertex: Joint, a: Joint, c: Joint): number | null {
	const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
	const v2 = { x: c.x - vertex.x, y: c.y - vertex.y };
	const dot = v1.x * v2.x + v1.y * v2.y;
	const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
	if (mag === 0) return null;
	const cos = Math.max(-1, Math.min(1, dot / mag));
	return (Math.acos(cos) * 180) / Math.PI;
}

export function shoulderWidth(s: Skeleton): number {
	return dist(s.leftShoulder, s.rightShoulder);
}

export function worldDist(a: WorldJoint, b: WorldJoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function worldShoulderWidth(s: WorldSkeleton): number {
	return worldDist(s.leftShoulder, s.rightShoulder);
}

// Elbow angle for one side, only when the whole arm chain is confident.
function sideElbowAngle(
	s: Skeleton,
	v: JointVisibility,
	shoulder: keyof Skeleton,
	elbow: keyof Skeleton,
	wrist: keyof Skeleton,
): number | null {
	const { SH_MIN, EW_MIN } = PUSHUP_PARAMS;
	if (conf(v, shoulder) < SH_MIN || conf(v, elbow) < EW_MIN || conf(v, wrist) < EW_MIN) {
		return null;
	}
	return angleAt(s[elbow], s[shoulder], s[wrist]);
}

// Fused elbow angle: average of whichever side(s) the model is confident about.
export function fusedElbowAngle(s: Skeleton, v: JointVisibility): number | null {
	const angles: number[] = [];
	const left = sideElbowAngle(s, v, 'leftShoulder', 'leftElbow', 'leftWrist');
	const right = sideElbowAngle(s, v, 'rightShoulder', 'rightElbow', 'rightWrist');
	if (left != null) angles.push(left);
	if (right != null) angles.push(right);
	if (angles.length === 0) return null;
	return angles.reduce((a, b) => a + b, 0) / angles.length;
}

/**
 * Robust push-up "depth" signal — high at the top (arms extended), low at the
 * bottom (chest near floor). Measured as the vertical gap from the shoulders to
 * the planted hands, normalized by shoulder width so it is scale-independent.
 *
 * Why not the elbow angle? In the floor-facing setup the SHOULDERS and PLANTED
 * HANDS are the most reliably tracked points; the ELBOWS occlude and lose
 * confidence at the bottom of every rep (which is exactly why the old
 * elbow-angle counter died there). This signal stays valid through the bottom.
 *
 * Returns null only when neither shoulders nor any wrist is tracked.
 */
export function bodyExtension(s: Skeleton, v: JointVisibility): number | null {
	const { DEPTH_MIN } = PUSHUP_PARAMS;
	if (conf(v, 'leftShoulder') < DEPTH_MIN || conf(v, 'rightShoulder') < DEPTH_MIN) {
		return null; // need both shoulders for a stable width reference
	}
	const width = shoulderWidth(s);
	if (width <= 0) return null;

	const shoulderMidY = (s.leftShoulder.y + s.rightShoulder.y) / 2;

	const leftW = conf(v, 'leftWrist') >= DEPTH_MIN;
	const rightW = conf(v, 'rightWrist') >= DEPTH_MIN;
	let wristY: number;
	if (leftW && rightW) wristY = (s.leftWrist.y + s.rightWrist.y) / 2;
	else if (leftW) wristY = s.leftWrist.y;
	else if (rightW) wristY = s.rightWrist.y;
	else return null;

	return (wristY - shoulderMidY) / width;
}

/**
 * View-independent push-up signal. At the top, shoulder→wrist distance is
 * close to the length of a straight arm; at the bottom, it shrinks as the arm
 * bends. The signal is normalized by world shoulder width and is therefore
 * usable from a front, 45-degree, or side camera position.
 *
 * A side is accepted independently so a short occlusion of one wrist/elbow
 * cannot destroy an otherwise valid rep. We deliberately use the raw world
 * landmarks rather than the screen/render smoother: counting must not lag the
 * athlete's motion merely to make the drawn skeleton look nicer.
 */
export function worldArmExtension(world: WorldSkeleton | undefined, v: JointVisibility): number | null {
	if (!world || conf(v, 'leftShoulder') < PUSHUP_PARAMS.DEPTH_MIN || conf(v, 'rightShoulder') < PUSHUP_PARAMS.DEPTH_MIN) {
		return null;
	}
	const width = worldShoulderWidth(world);
	if (!Number.isFinite(width) || width <= 0) return null;

	const extensions: number[] = [];
	if (conf(v, 'leftWrist') >= PUSHUP_PARAMS.DEPTH_MIN) {
		extensions.push(worldDist(world.leftShoulder, world.leftWrist) / width);
	}
	if (conf(v, 'rightWrist') >= PUSHUP_PARAMS.DEPTH_MIN) {
		extensions.push(worldDist(world.rightShoulder, world.rightWrist) / width);
	}
	if (extensions.length === 0) return null;
	return extensions.reduce((sum, value) => sum + value, 0) / extensions.length;
}
