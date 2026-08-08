/**
 * Small in-memory trace for field validation. It is deliberately bounded and
 * opt-in: a workout should never write camera or landmark data to disk merely
 * because rep counting is enabled.
 */
export interface CounterTraceSample {
	atMs: number;
	exercise: string;
	state: string;
	reason: string;
	signal?: number | null;
	trackingAgeMs?: number;
	// Pose model and derived movement values only — never raw landmarks, camera
	// frames, or video. This keeps the diagnostic safe to enable on a device.
	modelTier?: string;
	jump?: {
		state: string;
		leftFootRiseSW: number | null;
		rightFootRiseSW: number | null;
		pelvisRiseSW: number | null;
		footRiseSpeedSWs: number | null;
		pelvisRiseSpeedSWs: number | null;
		leftFootConfidence: number | null;
		rightFootConfidence: number | null;
	};
}

export class CounterTraceRecorder {
	private enabled = false;
	private samples: CounterTraceSample[] = [];

	constructor(
		private readonly capacity = 180,
		private readonly minIntervalMs = 100,
	) {}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	record(sample: CounterTraceSample): void {
		if (!this.enabled) return;
		const previous = this.samples[this.samples.length - 1];
		if (previous && sample.atMs - previous.atMs < this.minIntervalMs) {
			this.samples[this.samples.length - 1] = sample;
			return;
		}
		this.samples.push(sample);
		if (this.samples.length > this.capacity) this.samples.shift();
	}

	snapshot(): CounterTraceSample[] {
		return this.samples.map(sample => ({ ...sample }));
	}

	reset(): void {
		this.samples = [];
	}
}
