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
