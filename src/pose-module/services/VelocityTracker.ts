import type { JointVelocities, Skeleton } from '../types';

type VelocityState = Record<keyof JointVelocities, number>;

export class VelocityTracker {
	private prev: VelocityState | null = null;
	private prevTime: number | null = null;
	private smoothed: JointVelocities | null = null;

	constructor(private alpha: number) {}

	update(s: Skeleton, nowMs: number): JointVelocities | null {
		// Shoulder width in pixels - used to normalize velocity so the threshold
		// is independent of the user's distance from the camera.
		const shoulderWidth = Math.abs(s.leftShoulder.x - s.rightShoulder.x);
		const scale = shoulderWidth > 0 ? shoulderWidth : 1;

		const current: VelocityState = {
			leftWrist: s.leftWrist.y,
			rightWrist: s.rightWrist.y,
			leftAnkle: s.leftAnkle.y,
			rightAnkle: s.rightAnkle.y,
			pelvis: (s.leftHip.y + s.rightHip.y) / 2,
			nose: s.nose.y,
		};

		if (this.prev === null || this.prevTime === null) {
			this.prev = current;
			this.prevTime = nowMs;
			return null; // no velocity on the initial sample
		}

		const dt = (nowMs - this.prevTime) / 1000;
		if (dt <= 0) {
			return null; // duplicate timestamp, skip
		}

		const raw: JointVelocities = {
			leftWrist: (current.leftWrist - this.prev.leftWrist) / dt / scale,
			rightWrist: (current.rightWrist - this.prev.rightWrist) / dt / scale,
			leftAnkle: (current.leftAnkle - this.prev.leftAnkle) / dt / scale,
			rightAnkle: (current.rightAnkle - this.prev.rightAnkle) / dt / scale,
			pelvis: (current.pelvis - this.prev.pelvis) / dt / scale,
			nose: (current.nose - this.prev.nose) / dt / scale,
		};

		this.prev = current;
		this.prevTime = nowMs;
		this.smoothed = this.applyEma(raw);
		return this.smoothed;
	}

	private applyEma(raw: JointVelocities): JointVelocities {
		if (!this.smoothed) {
			return raw;
		}

		const a = this.alpha;
		const p = this.smoothed;

		return {
			leftWrist: a * raw.leftWrist + (1 - a) * p.leftWrist,
			rightWrist: a * raw.rightWrist + (1 - a) * p.rightWrist,
			leftAnkle: a * raw.leftAnkle + (1 - a) * p.leftAnkle,
			rightAnkle: a * raw.rightAnkle + (1 - a) * p.rightAnkle,
			pelvis: a * raw.pelvis + (1 - a) * p.pelvis,
			nose: a * raw.nose + (1 - a) * p.nose,
		};
	}

	reset(): void {
		this.prev = null;
		this.prevTime = null;
		this.smoothed = null;
	}
}
