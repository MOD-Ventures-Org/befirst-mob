import { PUSHUP_PARAMS } from './exercises/pushup.config';
import { conf, dist, midpoint, shoulderWidth } from './geometry';
import type { JointVisibility, Skeleton } from './types';

const P = PUSHUP_PARAMS;

// EMA weight for following the locked subject's position/scale.
const FOLLOW = 0.3;

/**
 * Primary-subject lock (issue 3).
 *
 * MediaPipe tracks one pose, but that pose can jump to a background shape and
 * snap back. The lock keeps a signature of the tracked person — shoulder
 * midpoint and shoulder width, EMA-followed while accepted — and rejects any
 * confident detection that teleports or rescales faster than a human can
 * move: `update()` returns false, and the caller treats the frame exactly
 * like a detection dropout (stabilizer holds → fades; counting sees nothing).
 * The skeleton is therefore never drawn on something that is not the tracked
 * subject.
 *
 * Re-locking: after SUBJECT_RELOCK_MS of continuous rejection or absence the
 * lock lets go and the next confident detection becomes the new subject —
 * without this, a person who legitimately relocated (mid-set rest) could
 * never be picked up again.
 *
 * Frames whose shoulders are not confident are not judged (accepted without
 * updating the signature): the confidence pipeline already handles them, and
 * a signature update from noise would corrupt the lock.
 */
export class SubjectLock {
	private midX: number | null = null;
	private midY = 0;
	private width = 0;
	private lastAcceptMs = 0;

	update(s: Skeleton, v: JointVisibility, nowMs: number): boolean {
		if (conf(v, 'leftShoulder') < P.SH_MIN || conf(v, 'rightShoulder') < P.SH_MIN) {
			return true; // cannot judge — low-confidence handling owns this frame
		}
		const width = shoulderWidth(s);
		if (width <= 0) return true;
		const mid = midpoint(s.leftShoulder, s.rightShoulder);

		// No lock, or the lock went stale (long rejection streak or absence):
		// adopt this detection as the subject.
		if (this.midX === null || nowMs - this.lastAcceptMs > P.SUBJECT_RELOCK_MS) {
			this.midX = mid.x;
			this.midY = mid.y;
			this.width = width;
			this.lastAcceptMs = nowMs;
			return true;
		}

		// Continuity check: allowed travel grows with time since the last
		// accepted frame, so a subject that moved during a brief occlusion is
		// still recognized.
		const dtS = Math.max(0.001, (nowMs - this.lastAcceptMs) / 1000);
		const allowed = Math.max(P.SUBJECT_JUMP_MAX, P.SUBJECT_DRIFT_PER_S * dtS) * this.width;
		const jump = dist(mid, { x: this.midX, y: this.midY });
		const scale = width / this.width;

		if (jump > allowed || scale > P.SUBJECT_SCALE_MAX || scale < 1 / P.SUBJECT_SCALE_MAX) {
			return false; // background shape / other person — not our subject
		}

		// Accepted — follow the subject.
		this.midX += (mid.x - this.midX) * FOLLOW;
		this.midY += (mid.y - this.midY) * FOLLOW;
		this.width += (width - this.width) * FOLLOW;
		this.lastAcceptMs = nowMs;
		return true;
	}

	reset(): void {
		this.midX = null;
		this.midY = 0;
		this.width = 0;
		this.lastAcceptMs = 0;
	}
}
