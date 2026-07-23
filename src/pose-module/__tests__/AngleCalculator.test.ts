import { computeAngles } from '../services/AngleCalculator';
import type { Skeleton } from '../types';

/**
 * Constructs a skeleton with only the specified joints set to meaningful
 * positions. Everything else defaults to the origin. When those origin joints
 * happen to be the vertex of an angleBetween call the implementation returns 0
 * (the mag===0 guard), so they do not pollute assertions for the joints under
 * test.
 */
function makeSkeleton(joints: Partial<Skeleton>): Skeleton {
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
    ...joints,
  };
}

describe('computeAngles', () => {
  describe('elbow angles', () => {
    it('returns 180 for a fully extended arm', () => {
      // shoulder=(0,0), -> elbow=(100,0) -> wrist=(200,0) - all collinear
      // ba=(-100,0), bc=(100,0), dot=-10000, cos=-1, angle=180
      const s = makeSkeleton({
        leftShoulder: { x: 0, y: 0 },
        leftElbow: { x: 100, y: 0 },
        leftWrist: { x: 200, y: 0 },
      });
      expect(computeAngles(s).leftElbow).toBeCloseTo(180);
    });

    it('returns 90 for a right-angle elbow bend', () => {
      // shoulder=(0,0), -> elbow=(100,0) -> wrist=(100,100)
      // ba=(-100,0), bc=(0,100), dot=0, cos=0, angle=90
      const s = makeSkeleton({
        leftShoulder: { x: 0, y: 0 },
        leftElbow: { x: 100, y: 0 },
        leftWrist: { x: 100, y: 100 },
      });
      expect(computeAngles(s).leftElbow).toBeCloseTo(90);
    });

    it('computes left and right elbow angles independently', () => {
      const s = makeSkeleton({
        // Left arm straight → 180°
        leftShoulder: { x: 0, y: 0 },
        leftElbow: { x: 1, y: 0 },
        leftWrist: { x: 2, y: 0 },
        // Right arm bent → 90°
        rightShoulder: { x: 0, y: 0 },
        rightElbow: { x: 1, y: 0 },
        rightWrist: { x: 1, y: 1 },
      });
      const angles = computeAngles(s);
      expect(angles.leftElbow).toBeCloseTo(180);
      expect(angles.rightElbow).toBeCloseTo(90);
    });
  });

  describe('backAngle', () => {
    it('returns ~180 when shoulder, hip and ankle are collinear', () => {
      // All joints on the same horizontal line -> back angle should be 180
      const s = makeSkeleton({
        leftShoulder: { x: 0, y: 50 },
        leftHip: { x: 100, y: 50 },
        leftAnkle: { x: 200, y: 50 },
        rightShoulder: { x: 0, y: -50 },
        rightHip: { x: 100, y: -50 },
        rightAnkle: { x: 200, y: -50 },
      });
      expect(computeAngles(s).backAngle).toBeCloseTo(180);
    });

    it('returns less than 160 when the hips are displaced from the shoulder-ankle line', () => {
      // Hip displaced 50px perpendicular to the shoulder-ankle axis
      // Computed angle at each hip 127
      const s = makeSkeleton({
        leftShoulder: { x: 0, y: 50 },
        leftHip: { x: 100, y: 100 }, // sags out of line
        leftAnkle: { x: 200, y: 50 },
        rightShoulder: { x: 0, y: -50 },
        rightHip: { x: 100, y: -100 },
        rightAnkle: { x: 200, y: -50 },
      });
      expect(computeAngles(s).backAngle).toBeLessThan(160);
    });

    it('is the average of the left and right side angles', () => {
      // Left:  shoulder=(0,0), hip=(100,0), ankle=(200,0) — collinear → 180°
      // Right: shoulder=(0,0), hip=(0,100), ankle=(100,100)
      //        ba=(0,-100), bc=(100,0), dot=0 → 90°
      // Expected average = (180 + 90) / 2 = 135°
      const s = makeSkeleton({
        leftShoulder: { x: 0, y: 0 },
        leftHip: { x: 100, y: 0 },
        leftAnkle: { x: 200, y: 0 },
        rightShoulder: { x: 0, y: 0 },
        rightHip: { x: 0, y: 100 },
        rightAnkle: { x: 100, y: 100 },
      });
      expect(computeAngles(s).backAngle).toBeCloseTo(135);
    });
  });

  describe('elbowFlare', () => {
    it('returns 0 when the elbow points along the torso (fully tucked)', () => {
      // elbow=(50,0), shoulder=(0,0), hip=(100,0) - elbow and hip on the same
      // ray from shoulder -> ba and bc parallel -> angle=0
      const s = makeSkeleton({
        leftElbow: { x: 50, y: 0 },
        leftShoulder: { x: 0, y: 0 },
        leftHip: { x: 100, y: 0 },
      });
      expect(computeAngles(s).elbowFlareLeft).toBeCloseTo(0);
    });

    it('returns 90 when the elbow is perpendicular to the torso (fully flared)', () => {
      // elbow=(0,100) is perpendicular to the shoulder->hip axis (100,0)
      // ba=(0,100), bc=(100,0), dot=0 → angle=90
      const s = makeSkeleton({
        leftElbow: { x: 0, y: 100 },
        leftShoulder: { x: 0, y: 0 },
        leftHip: { x: 100, y: 0 },
      });
      expect(computeAngles(s).elbowFlareLeft).toBeCloseTo(90);
    });
  });

  describe('spine angle', () => {
    it('returns 0 when the torso is perfectly vertical', () => {
      // Screen space: Y increases downward, so "above" means smaller Y.
      // torso vector = shoulderMid - hipMid = (0,-100)
      // acos(-torso.y / mag) = acos(100/100) = 0°
      const s = makeSkeleton({
        leftShoulder: { x: 0, y: -100 },
        rightShoulder: { x: 0, y: -100 },
        leftHip: { x: 0, y: 0 },
        rightHip: { x: 0, y: 0 },
      });
      expect(computeAngles(s).spine).toBeCloseTo(0);
    });

    it('returns 90 when the torso is horizontal', () => {
      // torso vector = (-200,0), torso.y=0 → acos(0) = 90°
      const s = makeSkeleton({
        leftShoulder: { x: -100, y: 0 },
        rightShoulder: { x: -100, y: 0 },
        leftHip: { x: 100, y: 0 },
        rightHip: { x: 100, y: 0 },
      });
      expect(computeAngles(s).spine).toBeCloseTo(90);
    });
  });

  describe('edge cases', () => {
    it('does not throw when all joints are at the origin', () => {
      expect(() => computeAngles(makeSkeleton({}))).not.toThrow();
    });

    it('returns 0 for any angle whose joints all coincide', () => {
      const angles = computeAngles(makeSkeleton({}));
      expect(angles.leftElbow).toBe(0);
      expect(angles.rightElbow).toBe(0);
      expect(angles.backAngle).toBe(0);
      expect(angles.elbowFlareLeft).toBe(0);
      expect(angles.elbowFlareRight).toBe(0);
    });
  });
});
