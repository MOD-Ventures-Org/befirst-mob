import { isUprightExtended } from '../posture';
import { RepDetector } from '../repDetector';
import type { Joint, JointVisibility, PoseFrame, Skeleton } from '../types';

// Synthetic frames use [0,1] coordinates for both view space and normalized
// space — all posture geometry is scale-invariant, so the unit does not matter.

function makeSkeleton(overrides: Partial<Record<keyof Skeleton, Joint>> = {}): Skeleton {
  // Default: person STANDING mid-frame at a valid distance (extent ≈ 0.76),
  // torso vertical, joints in anatomical order, arms hanging at the sides.
  const base: Skeleton = {
    nose: { x: 0.5, y: 0.12 },
    leftEye: { x: 0.48, y: 0.11 },
    rightEye: { x: 0.52, y: 0.11 },
    leftEar: { x: 0.46, y: 0.12 },
    rightEar: { x: 0.54, y: 0.12 },
    leftShoulder: { x: 0.45, y: 0.22 },
    rightShoulder: { x: 0.55, y: 0.22 },
    leftElbow: { x: 0.44, y: 0.35 },
    rightElbow: { x: 0.56, y: 0.35 },
    leftWrist: { x: 0.43, y: 0.48 },
    rightWrist: { x: 0.57, y: 0.48 },
    leftHip: { x: 0.46, y: 0.5 },
    rightHip: { x: 0.54, y: 0.5 },
    leftKnee: { x: 0.46, y: 0.7 },
    rightKnee: { x: 0.54, y: 0.7 },
    leftAnkle: { x: 0.46, y: 0.88 },
    rightAnkle: { x: 0.54, y: 0.88 },
  };
  return { ...base, ...overrides };
}

function makeVisibility(value = 0.9, overrides: Partial<JointVisibility> = {}): JointVisibility {
  const v = {} as JointVisibility;
  const joints: (keyof Skeleton)[] = [
    'nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar',
    'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
    'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
    'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
  ];
  for (const j of joints) v[j] = value;
  return { ...v, ...overrides };
}

function makeFrame(
  skeleton: Skeleton,
  visibility: JointVisibility = makeVisibility(),
): PoseFrame {
  return { skeleton, normalized: skeleton, visibility };
}

/**
 * Plank seen from the floor camera facing the athlete: shoulders mid-frame,
 * foreshortened torso going up-screen, straight arms planted below the
 * shoulders.
 */
function makePlankSkeleton(overrides: Partial<Record<keyof Skeleton, Joint>> = {}): Skeleton {
  return makeSkeleton({
    nose: { x: 0.5, y: 0.4 },
    leftEye: { x: 0.48, y: 0.39 },
    rightEye: { x: 0.52, y: 0.39 },
    leftEar: { x: 0.46, y: 0.4 },
    rightEar: { x: 0.54, y: 0.4 },
    leftShoulder: { x: 0.4, y: 0.45 },
    rightShoulder: { x: 0.6, y: 0.45 },
    leftElbow: { x: 0.4, y: 0.55 },
    rightElbow: { x: 0.6, y: 0.55 },
    leftWrist: { x: 0.4, y: 0.65 },
    rightWrist: { x: 0.6, y: 0.65 },
    leftHip: { x: 0.45, y: 0.35 },
    rightHip: { x: 0.55, y: 0.35 },
    leftKnee: { x: 0.46, y: 0.25 },
    rightKnee: { x: 0.54, y: 0.25 },
    leftAnkle: { x: 0.46, y: 0.15 },
    rightAnkle: { x: 0.55, y: 0.15 },
    ...overrides,
  });
}

/**
 * Head-on plank as the field test actually produced it (phone on the floor
 * facing the athlete): torso pointing INTO the frame, hips projected slightly
 * BELOW the shoulders (spine ≈ 0°), legs compressed to a tiny vertical span.
 * The original spine-angle rule misread this pose — regression case.
 */
function makeHeadOnPlankSkeleton(): Skeleton {
  return makeSkeleton({
    nose: { x: 0.5, y: 0.38 },
    leftEye: { x: 0.48, y: 0.37 },
    rightEye: { x: 0.52, y: 0.37 },
    leftEar: { x: 0.46, y: 0.38 },
    rightEar: { x: 0.54, y: 0.38 },
    leftShoulder: { x: 0.35, y: 0.45 },
    rightShoulder: { x: 0.65, y: 0.45 },
    leftElbow: { x: 0.35, y: 0.55 },
    rightElbow: { x: 0.65, y: 0.55 },
    leftWrist: { x: 0.35, y: 0.65 },
    rightWrist: { x: 0.65, y: 0.65 },
    leftHip: { x: 0.42, y: 0.5 },
    rightHip: { x: 0.58, y: 0.5 },
    leftKnee: { x: 0.44, y: 0.55 },
    rightKnee: { x: 0.56, y: 0.55 },
    leftAnkle: { x: 0.45, y: 0.58 },
    rightAnkle: { x: 0.55, y: 0.58 },
  });
}

describe('isUprightExtended (view-independent standing signal — the counting veto)', () => {
  it('true for a standing body (ankles far below the shoulders)', () => {
    const f = makeFrame(makeSkeleton());
    expect(isUprightExtended(f.skeleton, f.visibility)).toBe(true);
  });

  it('true via the knee fallback when ankles are not tracked', () => {
    const f = makeFrame(
      makeSkeleton(),
      makeVisibility(0.9, { leftAnkle: 0.2, rightAnkle: 0.2 }),
    );
    expect(isUprightExtended(f.skeleton, f.visibility)).toBe(true);
  });

  it('false for the head-on plank (legs compressed in the image)', () => {
    const f = makeFrame(makeHeadOnPlankSkeleton());
    expect(isUprightExtended(f.skeleton, f.visibility)).toBe(false);
  });

  it('false for the side-view plank (legs above the shoulders on screen)', () => {
    const f = makeFrame(makePlankSkeleton());
    expect(isUprightExtended(f.skeleton, f.visibility)).toBe(false);
  });

  it('false when no lower body is tracked (no verdict without evidence)', () => {
    const f = makeFrame(
      makeSkeleton(),
      makeVisibility(0.9, {
        leftAnkle: 0.2,
        rightAnkle: 0.2,
        leftKnee: 0.2,
        rightKnee: 0.2,
      }),
    );
    expect(isUprightExtended(f.skeleton, f.visibility)).toBe(false);
  });
});

describe('RepDetector reset semantics (count survives rest)', () => {
  function doRep(detector: RepDetector, startMs: number): number {
    let now = startMs;
    // Establish the envelope: top → bottom → top swings.
    for (const depth of [2.0, 1.0, 2.0, 1.0, 2.0]) {
      detector.update(depth, now);
      now += 600;
    }
    return now;
  }

  it('resetSignal keeps the rep count, reset clears it', () => {
    const detector = new RepDetector();
    const now = doRep(detector, 0);
    expect(detector.getRepCount()).toBeGreaterThan(0);
    const count = detector.getRepCount();

    detector.resetSignal();
    expect(detector.getRepCount()).toBe(count);

    // Counting continues after the envelope is re-learned.
    doRep(detector, now + 5000);
    expect(detector.getRepCount()).toBeGreaterThan(count);

    detector.reset();
    expect(detector.getRepCount()).toBe(0);
  });
});
