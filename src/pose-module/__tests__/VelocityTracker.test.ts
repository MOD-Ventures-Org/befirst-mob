import { VelocityTracker } from '../services/VelocityTracker';
import type { Skeleton } from '../types';

function makeSkeleton(overrides: Partial<Skeleton> = {}): Skeleton {
  const o = { x: 0, y: 0 };
  return {
    nose: o,
    leftEye: o,
    rightEye: o,
    leftEar: o,
    rightEar: o,
    leftShoulder: o,
    rightShoulder: o,
    leftElbow: o,
    rightElbow: o,
    leftWrist: o,
    rightWrist: o,
    leftHip: o,
    rightHip: o,
    leftKnee: o,
    rightKnee: o,
    leftAnkle: o,
    rightAnkle: o,
    ...overrides,
  };
}

/**
 * Skeleton with a fixed shoulder width of 100px and wrist at the given Y.
 * Used by most tests so they only have to think about wristY.
 * velocity = wristDeltaY / dtSeconds / 100
 */
function frame(wristY: number, hipY = 0): Skeleton {
  return makeSkeleton({
    leftShoulder: { x: 0, y: 0 },
    rightShoulder: { x: 100, y: 0 }, // shoulder width = 100
    leftWrist: { x: 0, y: wristY },
    rightWrist: { x: 0, y: wristY },
    leftHip: { x: 0, y: hipY },
    rightHip: { x: 0, y: hipY },
    nose: { x: 0, y: wristY },
  });
}

describe('VelocityTracker', () => {
  describe('null conditions', () => {
    it('returns null on the first call (no previous frame', () => {
      const tracker = new VelocityTracker(1);
      expect(tracker.update(frame(0), 0)).toBeNull();
    });

    it('returns null when the timestamp is identical to the previous frame', () => {
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 0);
      expect(tracker.update(frame(100), 0)).toBeNull();
    });

    it('returns null when the timestamp is earlier than the previous frame', () => {
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 100);
      expect(tracker.update(frame(100), 50)).toBeNull();
    });

    it('does not update state on a duplicate timestamp, so the next valid call still works', () => {
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 0);
      tracker.update(frame(999), 0); // duplicate timestamp, should be ignored
      const result = tracker.update(frame(100), 1000);

      // (100-0)/1s/100px-width = 1.0
      expect(result!.leftWrist).toBeCloseTo(1.0);
    });
  });

  describe('velocity computation', () => {
    it('computes a positive velocity when the joint moves downward (Y increases)', () => {
      // Positive Y direction = down in screen space
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 0);
      const result = tracker.update(frame(100), 1000);

      // (100 - 0)/1s/100px-width = 1.0
      expect(result!.leftWrist).toBeCloseTo(1.0);
    });

    it('scales velocity with the time delta', () => {
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 0);
      const result = tracker.update(frame(100), 500); // 0.5s later

      // (100 - 0)/0.5s/100px-width = 2.0
      expect(result!.leftWrist).toBeCloseTo(2.0);
    });

    it('computes pelvis velocity as the midpoint of left and right hip Y', () => {
      const tracker = new VelocityTracker(1);
      // Frame 1: leftHip=0, rightHip=0 -> pelvis=0
      tracker.update(frame(0, 0), 0);
      // Frame 2: leftHip=50, rightHip=150 -> pelvis=100
      const s = makeSkeleton({
        leftShoulder: { x: 0, y: 0 },
        rightShoulder: { x: 100, y: 0 },
        leftHip: { x: 0, y: 50 },
        rightHip: { x: 0, y: 150 },
      });

      const result = tracker.update(s, 1000);

      // (100 - 0)/1s/100px-width = 1.0
      expect(result!.pelvis).toBeCloseTo(1.0);
    });
  });

  describe('shoulder-width normalization', () => {
    it('produces a smaller normalized velocity when the person appears larger in frame', () => {
      // Same physical displacement (100px in 1s), but different shoulder widths.
      // Wider apparent shoulders = person closer to camera = lower normalized value.
      const move = (width: number) => {
        const t = new VelocityTracker(1);
        t.update(
          makeSkeleton({
            leftShoulder: { x: 0, y: 0 },
            rightShoulder: { x: width, y: 0 },
            leftWrist: { x: 0, y: 0 },
          }),
          0,
        );
        return t.update(
          makeSkeleton({
            leftShoulder: { x: 0, y: 0 },
            rightShoulder: { x: width, y: 0 },
            leftWrist: { x: 0, y: 100 },
          }),
          1000,
        );
      };

      const narrow = move(100); // 100/1/100 = 1.0
      const wide = move(200); // 100/1/200 = 0.5

      expect(narrow!.leftWrist).toBeCloseTo(1.0);
      expect(wide!.leftWrist).toBeCloseTo(0.5);
    });

    it('falls back to scale=1 when both shoulders share the same X (zero width)', () => {
      const tracker = new VelocityTracker(1);
      // leftShoulder.x == rightShoulder.x -> shoulderWidth=0 -> scale=1
      tracker.update(
        makeSkeleton({
          leftShoulder: { x: 50, y: 0 },
          rightShoulder: { x: 50, y: 0 },
          leftWrist: { x: 0, y: 0 },
        }),
        0,
      );
      const result = tracker.update(
        makeSkeleton({
          leftShoulder: { x: 50, y: 0 },
          rightShoulder: { x: 50, y: 0 },
          leftWrist: { x: 0, y: 100 },
        }),
        1000,
      );

      // (100 - 0)/1s/1 (fallback) = 100
      expect(result!.leftWrist).toBeCloseTo(100);
    });
  });

  describe('EMA smoothing', () => {
    it('returns the raw velocity on the first non-null call', () => {
      const tracker = new VelocityTracker(0); // alpha=0 would suppress raw — but there's no prev yet
      tracker.update(frame(0), 0);
      const result = tracker.update(frame(100), 1000);

      // No previous smoothed value, so raw is returned returned directly
      expect(result!.leftWrist).toBeCloseTo(1.0);
    });

    it('with alpha=1 the output equals to the raw velocity', () => {
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 0);
      tracker.update(frame(100), 1000);
      const result = tracker.update(frame(300), 2000);

      expect(result!.leftWrist).toBeCloseTo(2.0); // raw velocity for this frame is 2.0
    });

    it('with alpha=0 the output equals to the previous smoothed value', () => {
      const tracker = new VelocityTracker(0);
      tracker.update(frame(0), 0);
      tracker.update(frame(100), 1000);
      const result = tracker.update(frame(300), 2000);

      expect(result!.leftWrist).toBeCloseTo(1.0); // smoothed value should not change from previous frame
    });
  });

  describe('state management', () => {
    it('computes velocity relative to the previous frame, not the initial frame', () => {
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 0);
      tracker.update(frame(100), 1000);
      const result = tracker.update(frame(100), 2000); // no movement since last frame, so velocity should be 0

      expect(result!.leftWrist).toBeCloseTo(0);
    });

    it('returns null immediately after reset', () => {
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 0);
      tracker.update(frame(100), 1000);
      tracker.reset();

      expect(tracker.update(frame(200), 2000)).toBeNull();
    });

    it('uses the post-reset frame as the new baseline, not pre-reset state', () => {
      const tracker = new VelocityTracker(1);
      tracker.update(frame(0), 0);
      tracker.update(frame(500), 1000);
      tracker.reset();

      tracker.update(frame(0), 2000); // new baseline: y=0
      const result = tracker.update(frame(100), 3000);

      // Should diff from y=0 (post-reset), not y=500 (pre-reset)
      // (100 - 0) / 1s / 100 = 1.0  (not (100-500)/1/100 = -4.0)
      expect(result!.leftWrist).toBeCloseTo(1.0);
    });
  });
});
