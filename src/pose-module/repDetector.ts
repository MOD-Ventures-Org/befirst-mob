import { PUSHUP_PARAMS } from './exercises/pushup.config';

const P = PUSHUP_PARAMS;

export interface RepUpdate {
	repCount: number;
	repJustCounted: boolean;
}

// Keeps `sorted` as the `capacity` most extreme values seen, ordered by
// `compare` (best first) — a bounded insertion sort, cheaper than sorting the
// whole window every frame.
function collectExtremes(
	sorted: number[],
	value: number,
	capacity: number,
	compare: (a: number, b: number) => number,
): void {
	let index = sorted.length;
	while (index > 0 && compare(value, sorted[index - 1]) < 0) index -= 1;
	if (index >= capacity) return;

	sorted.splice(index, 0, value);
	if (sorted.length > capacity) sorted.pop();
}

const ascending = (a: number, b: number): number => a - b;
const descending = (a: number, b: number): number => b - a;

/**
 * Adaptive vertical-oscillation rep counter.
 *
 * Instead of comparing the elbow angle to fixed thresholds (which dies when the
 * arms occlude at the bottom of a rep), this tracks a robust "depth" signal
 * (shoulder→hand vertical gap) and learns the user's own range with a decaying
 * min/max envelope. A rep is a full down→up swing across that range:
 *   - dip below  `min + band·range`  (reach the bottom), then
 *   - rise above `max − band·range`  (return to the top)  -> count.
 *
 * This survives tracking dropouts, adapts to body size/form (no fixed angles),
 * counts knee push-ups (legs ignored), and rejects shallow partial dips and
 * tiny jitter (via `REP_MIN_RANGE` + the refractory period).
 */
export class RepDetector {
	private min = Infinity;
	private max = -Infinity;
	private state: 'INIT' | 'TOP' | 'BOTTOM' = 'INIT';
	private repCount = 0;
	private lastRepMs = 0;
	// Display envelope for the games' position signal, measured over a rolling
	// window of recent depths and kept independent of the counting envelope.
	private displaySamples: number[] = [];
	private displayWriteIndex = 0;
	private displayMin = Infinity;
	private displayMax = -Infinity;
	private displayCalibrated = false;

	update(depth: number, nowMs: number): RepUpdate {
		// Decaying min/max envelope -> the user's live depth range.
		const keep = P.DEPTH_RANGE_DECAY;
		this.max = depth > this.max ? depth : this.max + (depth - this.max) * (1 - keep);
		this.min = depth < this.min ? depth : this.min + (depth - this.min) * (1 - keep);

		const range = this.max - this.min;
		let repJustCounted = false;

		if (range >= P.REP_MIN_RANGE) {
			const bottomLine = this.min + P.REP_BAND * range;
			const topLine = this.max - P.REP_BAND * range;

			switch (this.state) {
				case 'INIT':
					if (depth >= topLine) this.state = 'TOP';
					else if (depth <= bottomLine) this.state = 'BOTTOM';
					break;
				case 'TOP':
					if (depth <= bottomLine) this.state = 'BOTTOM';
					break;
				case 'BOTTOM':
					if (depth >= topLine) {
						if (nowMs - this.lastRepMs >= P.REP_MIN_MS) {
							this.repCount += 1;
							this.lastRepMs = nowMs;
							repJustCounted = true;
						}
						this.state = 'TOP';
					}
					break;
			}
		}

		return { repCount: this.repCount, repJustCounted };
	}

	private recordDisplaySample(depth: number): void {
		if (this.displaySamples.length < P.DISPLAY_WINDOW_FRAMES) {
			this.displaySamples.push(depth);
			return;
		}

		this.displaySamples[this.displayWriteIndex] = depth;
		this.displayWriteIndex = (this.displayWriteIndex + 1) % P.DISPLAY_WINDOW_FRAMES;
	}

	private windowEnvelope(): { low: number; high: number } {
		const samples = this.displaySamples;
		const trim = samples.length >= P.DISPLAY_ENVELOPE_TRIM * 2 + 3 ? P.DISPLAY_ENVELOPE_TRIM : 0;
		const capacity = trim + 1;
		const lowest: number[] = [];
		const highest: number[] = [];

		for (let i = 0; i < samples.length; i += 1) {
			collectExtremes(lowest, samples[i], capacity, ascending);
			collectExtremes(highest, samples[i], capacity, descending);
		}

		return { low: lowest[lowest.length - 1], high: highest[highest.length - 1] };
	}

	/**
	 * Normalized body height for the mini-games (PushUpSignal `position`):
	 * 0 = bottom of the push-up, 1 = top.
	 *
	 * The envelope comes from a rolling window of recent depths, so an outlier
	 * frame (plank entry, half-detected skeleton, repositioning) stops driving
	 * the mapping once it leaves the window instead of flattening the signal
	 * for the rest of the session. A window narrower than a real rep (holding
	 * at the top, resting, a brief dropout) keeps the last valid envelope, so
	 * the sprite holds its position rather than collapsing to a 0-range.
	 *
	 * Null only before the first valid envelope and after a full `reset()`.
	 */
	observeDepth(depth: number): number | null {
		this.recordDisplaySample(depth);

		const { low, high } = this.windowEnvelope();
		if (high - low >= P.REP_MIN_RANGE) {
			this.displayMin = low;
			this.displayMax = high;
			this.displayCalibrated = true;
		}
		if (!this.displayCalibrated) return null;

		// Remap the central band to the full 0-1 so the sprite reaches both
		// screen edges even when transition frames widened the envelope.
		const raw = (depth - this.displayMin) / (this.displayMax - this.displayMin);
		const remapped = (raw - P.POSITION_REMAP_LO) / (P.POSITION_REMAP_HI - P.POSITION_REMAP_LO);
		return Math.min(1, Math.max(0, remapped));
	}

	getRepCount(): number {
		return this.repCount;
	}

	// Clears the learned depth envelope but keeps the rep count. Use on body
	// loss / mid-set rest — the counter must survive disarm (issue 1, doc §2).
	// The display window is dropped too (samples from before the loss can
	// describe a different framing), while the last valid display envelope is
	// kept so the game sprite does not jump.
	resetSignal(): void {
		this.min = Infinity;
		this.max = -Infinity;
		this.state = 'INIT';
		this.displaySamples = [];
		this.displayWriteIndex = 0;
	}

	// Full reset including the rep count — only for starting a new session.
	reset(): void {
		this.resetSignal();
		this.repCount = 0;
		this.lastRepMs = 0;
		this.displayMin = Infinity;
		this.displayMax = -Infinity;
		this.displayCalibrated = false;
	}
}
