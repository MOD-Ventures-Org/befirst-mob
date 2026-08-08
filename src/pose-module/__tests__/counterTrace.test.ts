import { CounterTraceRecorder } from '../counterTrace';

describe('CounterTraceRecorder', () => {
	it('is opt-in, samples at a bounded rate, and retains a bounded history', () => {
		const trace = new CounterTraceRecorder(2, 100);
		trace.record({ atMs: 0, exercise: 'pushup', state: 'TOP', reason: 'disabled' });
		expect(trace.snapshot()).toEqual([]);

		trace.setEnabled(true);
		trace.record({ atMs: 0, exercise: 'pushup', state: 'TOP', reason: 'top' });
		trace.record({ atMs: 50, exercise: 'pushup', state: 'BOTTOM', reason: 'bottom' });
		trace.record({ atMs: 200, exercise: 'pushup', state: 'TOP', reason: 'top' });
		trace.record({ atMs: 400, exercise: 'pushup', state: 'TOP', reason: 'counted' });

		expect(trace.snapshot()).toEqual([
			{ atMs: 200, exercise: 'pushup', state: 'TOP', reason: 'top' },
			{ atMs: 400, exercise: 'pushup', state: 'TOP', reason: 'counted' },
		]);
	});

	it('retains derived jump diagnostics without accepting raw landmark data', () => {
		const trace = new CounterTraceRecorder();
		trace.setEnabled(true);
		trace.record({
			atMs: 1_000,
			exercise: 'jump-squat',
			state: 'airborne',
			reason: 'Jump detected — land softly',
			modelTier: 'full',
			jump: {
				state: 'airborne',
				leftFootRiseSW: 0.14,
				rightFootRiseSW: 0.13,
				pelvisRiseSW: 0.21,
				footRiseSpeedSWs: 0.8,
				pelvisRiseSpeedSWs: 0.7,
				leftFootConfidence: 0.91,
				rightFootConfidence: 0.88,
			},
		});

		expect(trace.snapshot()).toEqual([
			expect.objectContaining({
				modelTier: 'full',
				jump: expect.objectContaining({ state: 'airborne', pelvisRiseSW: 0.21 }),
			}),
		]);
	});
});
