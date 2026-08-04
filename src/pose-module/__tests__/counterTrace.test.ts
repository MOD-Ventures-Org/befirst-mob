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
});
