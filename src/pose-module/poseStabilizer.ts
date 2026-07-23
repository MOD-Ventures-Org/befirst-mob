import { PUSHUP_PARAMS } from './exercises/pushup.config';
import type { RawPose, RenderPoint, RenderPose } from './types';

const P = PUSHUP_PARAMS;

// RENDER_POINTS indices of the shoulders — the teleport cap's scale and
// body-motion references (they are the highest-confidence anchors).
const L_SHOULDER = 0;
const R_SHOULDER = 1;
const FALLBACK_SHOULDER_W = 60; // px, only until shoulders are first seen

interface JointState {
	x: number;
	y: number;
	alpha: number;
	lastPresentMs: number;
	everPresent: boolean;
}

/**
 * Temporal stabilizer for the drawn skeleton (issue 4).
 *
 * Turns noisy per-frame detections into rendering that can not blink, jump,
 * or dance, in the doc's priority order:
 *
 * 1. NEVER BLINK — visibility is a continuous alpha whose per-frame change is
 *    rate-capped (FADE_IN_PER_S / FADE_OUT_PER_S). A joint physically cannot
 *    disappear for one frame and pop back.
 * 2. HOLD-LAST-KNOWN — a joint that stops being tracked keeps its last
 *    position at full alpha for HOLD_BEFORE_FADE_MS (~half a second).
 * 3. CONFIDENCE FADE — after the hold window the joint fades out gradually;
 *    inferred (guessed) limbs are capped at INFERRED_ALPHA so priors never
 *    look as certain as tracked limbs.
 * 4. NO TELEPORTING — per-frame joint travel is capped relative to shoulder
 *    width plus whole-body motion; a detection that jumps across the screen
 *    is walked toward, not snapped to, so single-frame spikes are absorbed.
 *
 * Whole-body loss follows the same hold → fade path instead of the previous
 * hard cutoff after N frames.
 */
export class PoseStabilizer {
	private joints: JointState[] = [];
	private tier: RenderPose['tier'] = 'FULL';
	private bodyLostSinceMs: number | null = null;
	private prevMs: number | null = null;

	update(raw: RawPose, hasBody: boolean, nowMs: number): RenderPose | null {
		const dt = this.prevMs === null ? 1 / 30 : Math.max(0.001, (nowMs - this.prevMs) / 1000);
		this.prevMs = nowMs;

		if (!hasBody || raw.pts.length === 0) {
			return this.fadeAllOut(nowMs, dt);
		}
		this.bodyLostSinceMs = null;
		this.tier = raw.tier;

		const maxStep = this.maxStepPx(raw, dt);

		const pts: RenderPoint[] = raw.pts.map((pt, i) => {
			let state = this.joints[i];
			if (!state) {
				state = {
					x: pt.x,
					y: pt.y,
					alpha: 0,
					lastPresentMs: pt.present ? nowMs : -Infinity,
					everPresent: false,
				};
				this.joints[i] = state;
			}

			if (pt.present) {
				this.moveCapped(state, pt.x, pt.y, maxStep);
				state.lastPresentMs = nowMs;
				const target = pt.inferred ? P.INFERRED_ALPHA : 1;
				state.alpha = approach(state.alpha, target, dt);
				state.everPresent = true;
			} else if (nowMs - state.lastPresentMs > P.HOLD_BEFORE_FADE_MS) {
				// Held long enough — fade, position frozen (no dancing while dim).
				state.alpha = approach(state.alpha, 0, dt);
			}
			// else: inside the hold window — keep position and alpha untouched.

			return {
				x: state.x,
				y: state.y,
				alpha: state.alpha,
				show: state.alpha > P.ALPHA_HIDE_EPS,
				// Uncertain = anything drawn from other than a trusted detection:
				// low confidence, inferred prior, or held/fading position (issue 5).
				uncertain: !pt.present || pt.inferred === true || pt.uncertain === true,
			};
		});

		return { tier: this.tier, pts };
	}

	reset(): void {
		this.joints = [];
		this.bodyLostSinceMs = null;
		this.prevMs = null;
	}

	// Hold the whole last skeleton through brief body loss, then fade it out.
	// Returns null only after everything has faded to invisible.
	private fadeAllOut(nowMs: number, dt: number): RenderPose | null {
		if (this.joints.length === 0) return null;
		if (this.bodyLostSinceMs === null) this.bodyLostSinceMs = nowMs;

		const fading = nowMs - this.bodyLostSinceMs > P.HOLD_BEFORE_FADE_MS;
		let anyVisible = false;

		const pts: RenderPoint[] = this.joints.map(state => {
			if (fading) state.alpha = approach(state.alpha, 0, dt);
			const show = state.alpha > P.ALPHA_HIDE_EPS;
			if (show) anyVisible = true;
			// Everything drawn during body loss is a held position — uncertain.
			return { x: state.x, y: state.y, alpha: state.alpha, show, uncertain: true };
		});

		if (!anyVisible) {
			this.joints = [];
			return null;
		}
		return { tier: this.tier, pts };
	}

	// Per-frame travel budget: a fraction of shoulder width (scaled by dt via
	// the caller's frame cadence) plus however far the whole body moved this
	// frame, so fast genuine motion is never clamped.
	private maxStepPx(raw: RawPose, dt: number): number {
		const ls = this.joints[L_SHOULDER];
		const rs = this.joints[R_SHOULDER];
		const rawL = raw.pts[L_SHOULDER];
		const rawR = raw.pts[R_SHOULDER];

		let shoulderW = FALLBACK_SHOULDER_W;
		if (rawL && rawR && rawL.present && rawR.present) {
			shoulderW = Math.hypot(rawL.x - rawR.x, rawL.y - rawR.y) || FALLBACK_SHOULDER_W;
		}

		let bodyDelta = 0;
		if (ls && rs && rawL && rawR && rawL.present && rawR.present && ls.everPresent && rs.everPresent) {
			const prevMidX = (ls.x + rs.x) / 2;
			const prevMidY = (ls.y + rs.y) / 2;
			const newMidX = (rawL.x + rawR.x) / 2;
			const newMidY = (rawL.y + rawR.y) / 2;
			bodyDelta = Math.hypot(newMidX - prevMidX, newMidY - prevMidY);
		}

		// Normalize the fraction to a 30 fps frame so the cap is cadence-stable.
		return P.TELEPORT_MAX_FRAC * shoulderW * (dt * 30) + bodyDelta;
	}

	private moveCapped(state: JointState, x: number, y: number, maxStep: number): void {
		if (!state.everPresent) {
			// First confident sighting — take the position as-is (fade-in covers it).
			state.x = x;
			state.y = y;
			return;
		}
		const dx = x - state.x;
		const dy = y - state.y;
		const jump = Math.hypot(dx, dy);
		if (jump <= maxStep || jump === 0) {
			state.x = x;
			state.y = y;
			return;
		}
		// Detection error or genuine sprint: walk toward it at the cap. Real
		// moves converge in a few frames; single-frame spikes barely register.
		const k = maxStep / jump;
		state.x += dx * k;
		state.y += dy * k;
	}
}

// Rate-limited approach — alpha may change by at most rate·dt per frame.
function approach(current: number, target: number, dt: number): number {
	const rate = target > current ? P.FADE_IN_PER_S : P.FADE_OUT_PER_S;
	const step = rate * dt;
	if (Math.abs(target - current) <= step) return target;
	return current + Math.sign(target - current) * step;
}
