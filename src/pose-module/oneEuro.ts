import { PUSHUP_PARAMS } from './exercises/pushup.config';
import type { Skeleton } from './types';

// One Euro filter (Casiez et al.) — low cutoff when still (kills jitter), high
// cutoff when moving fast (keeps latency low). Standard for AR pose overlays.

function smoothingAlpha(cutoff: number, dt: number): number {
	const tau = 1 / (2 * Math.PI * cutoff);
	return 1 / (1 + tau / dt);
}

class OneEuroScalar {
	private xPrev: number | null = null;
	private dxPrev = 0;

	constructor(
		private minCutoff: number,
		private beta: number,
		private dCutoff: number,
	) {}

	filter(x: number, dt: number): number {
		if (this.xPrev === null || dt <= 0) {
			this.xPrev = x;
			this.dxPrev = 0;
			return x;
		}
		const dx = (x - this.xPrev) / dt;
		const dxHat = this.dxPrev + smoothingAlpha(this.dCutoff, dt) * (dx - this.dxPrev);
		const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
		const xHat = this.xPrev + smoothingAlpha(cutoff, dt) * (x - this.xPrev);
		this.xPrev = xHat;
		this.dxPrev = dxHat;
		return xHat;
	}

	reset(): void {
		this.xPrev = null;
		this.dxPrev = 0;
	}
}

class OneEuroPoint {
	private fx: OneEuroScalar;
	private fy: OneEuroScalar;

	constructor(minCutoff: number, beta: number, dCutoff: number) {
		this.fx = new OneEuroScalar(minCutoff, beta, dCutoff);
		this.fy = new OneEuroScalar(minCutoff, beta, dCutoff);
	}

	filter(x: number, y: number, dt: number): { x: number; y: number } {
		return { x: this.fx.filter(x, dt), y: this.fy.filter(y, dt) };
	}

	reset(): void {
		this.fx.reset();
		this.fy.reset();
	}
}

export class SkeletonOneEuro {
	private points = new Map<keyof Skeleton, OneEuroPoint>();
	private prevTime: number | null = null;

	private pointFor(joint: keyof Skeleton): OneEuroPoint {
		let p = this.points.get(joint);
		if (!p) {
			p = new OneEuroPoint(
				PUSHUP_PARAMS.ONE_EURO_MIN_CUTOFF,
				PUSHUP_PARAMS.ONE_EURO_BETA,
				PUSHUP_PARAMS.ONE_EURO_DCUTOFF,
			);
			this.points.set(joint, p);
		}
		return p;
	}

	filter(skeleton: Skeleton, nowMs: number): Skeleton {
		const dt = this.prevTime === null ? 1 / 30 : (nowMs - this.prevTime) / 1000;
		this.prevTime = nowMs;

		const out = {} as Skeleton;
		for (const joint of Object.keys(skeleton) as (keyof Skeleton)[]) {
			out[joint] = this.pointFor(joint).filter(skeleton[joint].x, skeleton[joint].y, dt);
		}
		return out;
	}

	reset(): void {
		for (const p of this.points.values()) p.reset();
		this.prevTime = null;
	}
}
