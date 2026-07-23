import { PUSHUP_PARAMS } from '../exercises/pushup.config';
import { RepDetector } from '../repDetector';

const P = PUSHUP_PARAMS;

describe('RepDetector.observeDepth (PushUpSignal position)', () => {
  it('is null before the envelope spans a real rep range', () => {
    const detector = new RepDetector();
    // Tiny jitter around one depth — range stays below REP_MIN_RANGE.
    expect(detector.observeDepth(1.0)).toBeNull();
    expect(detector.observeDepth(1.0 + P.REP_MIN_RANGE / 4)).toBeNull();
  });

  it('normalizes 0 = bottom, 1 = top once calibrated, clamped', () => {
    const detector = new RepDetector();
    detector.observeDepth(1.5); // top
    detector.observeDepth(0.5); // bottom — range 1.0 >= REP_MIN_RANGE

    expect(detector.observeDepth(1.5)).toBeCloseTo(1, 2);
    expect(detector.observeDepth(0.5)).toBeCloseTo(0, 2);
    expect(detector.observeDepth(1.0)).toBeCloseTo(0.5, 1);

    // Overshooting the learned envelope clamps instead of leaving [0, 1]...
    expect(detector.observeDepth(2.0)).toBe(1);
    // ...and instantly extends the envelope for the next frames.
    expect(detector.observeDepth(0.5)).toBeCloseTo(0, 2);
  });

  it('never invalidates during a long hold (the "stuck sprite" fix)', () => {
    const detector = new RepDetector();
    detector.observeDepth(1.5);
    detector.observeDepth(0.5);

    // Hold near the top for a thousand frames — the position must keep
    // flowing, never null.
    let position: number | null = null;
    for (let i = 0; i < 1000; i += 1) {
      position = detector.observeDepth(1.4);
      expect(position).not.toBeNull();
    }
    expect(position as number).toBeGreaterThan(0.5);
  });

  it('survives resetSignal (mid-set rest) and clears only on full reset', () => {
    const detector = new RepDetector();
    detector.observeDepth(1.5);
    detector.observeDepth(0.5);
    expect(detector.observeDepth(1.0)).not.toBeNull();

    detector.resetSignal();
    expect(detector.observeDepth(1.0)).not.toBeNull();

    detector.reset();
    expect(detector.observeDepth(1.0)).toBeNull();
  });
});
