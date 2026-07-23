import type { Joint, JointAngles, Skeleton } from '../types';

function angleBetween(a: Joint, vertex: Joint, b: Joint): number {
	const ba = { x: a.x - vertex.x, y: a.y - vertex.y };
	const bc = { x: b.x - vertex.x, y: b.y - vertex.y };
	const dot = ba.x * bc.x + ba.y * bc.y;
	const mag = Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y);
	if (mag === 0) {
		return 0;
	}
	return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function spineAngle(s: Skeleton): number {
	const shoulderMid = {
		x: (s.leftShoulder.x + s.rightShoulder.x) / 2,
		y: (s.leftShoulder.y + s.rightShoulder.y) / 2,
	};
	const hipMid = {
		x: (s.leftHip.x + s.rightHip.x) / 2,
		y: (s.leftHip.y + s.rightHip.y) / 2,
	};

	// Torso vector: from hips up toward shoulders
	const torso = {
		x: shoulderMid.x - hipMid.x,
		y: shoulderMid.y - hipMid.y,
	};

	const mag = Math.hypot(torso.x, torso.y);
	if (mag === 0) {
		return 0;
	}

	// Vertical reference in screen space: (0, -1) - Y increases downward
	// dot product with (0, -1) simplifies to -torso.y
	return (Math.acos(Math.max(-1, Math.min(1, -torso.y / mag))) * 180) / Math.PI;
}

export function computeAngles(s: Skeleton): JointAngles {
	return {
		leftElbow: angleBetween(s.leftShoulder, s.leftElbow, s.leftWrist),
		rightElbow: angleBetween(s.rightShoulder, s.rightElbow, s.rightWrist),
		leftKnee: angleBetween(s.leftHip, s.leftKnee, s.leftAnkle),
		rightKnee: angleBetween(s.rightHip, s.rightKnee, s.rightAnkle),
		leftHip: angleBetween(s.leftShoulder, s.leftHip, s.leftKnee),
		rightHip: angleBetween(s.rightShoulder, s.rightHip, s.rightKnee),
		spine: spineAngle(s),

		backAngle:
			(angleBetween(s.leftShoulder, s.leftHip, s.leftAnkle) + angleBetween(s.rightShoulder, s.rightHip, s.rightAnkle)) /
			2,
		elbowFlareLeft: angleBetween(s.leftElbow, s.leftShoulder, s.leftHip),
		elbowFlareRight: angleBetween(s.rightElbow, s.rightShoulder, s.rightHip),
	};
}
