import { PUSHUP_PARAMS } from '../exercises/pushup.config';
import { bodyExtension } from '../geometry';
import { isUprightExtended } from '../posture';
import { RepDetector } from '../repDetector';
import type { Joint, JointVisibility, PoseFrame, Skeleton } from '../types';

// End-to-end check of the gate-free counting pipeline: there is no readiness
// ritual — the first push-up counts immediately. The upright veto
// (isUprightExtended) is the only per-frame guard, exactly the composition
// usePoseSession wires per frame.

const P = PUSHUP_PARAMS;
const DT = 33;

function makeVisibility(value = 0.9): JointVisibility {
  const v = {} as JointVisibility;
  const joints: (keyof Skeleton)[] = [
    'nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar',
    'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
    'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
    'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
  ];
  for (const j of joints) v[j] = value;
  return v;
}

function standingSkeleton(wristDrop = 0.26): Skeleton {
  // Standing person; wristDrop moves the wrists to simulate arm bends.
  return {
    nose: { x: 0.5, y: 0.12 },
    leftEye: { x: 0.48, y: 0.11 },
    rightEye: { x: 0.52, y: 0.11 },
    leftEar: { x: 0.46, y: 0.12 },
    rightEar: { x: 0.54, y: 0.12 },
    leftShoulder: { x: 0.45, y: 0.22 },
    rightShoulder: { x: 0.55, y: 0.22 },
    leftElbow: { x: 0.44, y: 0.35 },
    rightElbow: { x: 0.56, y: 0.35 },
    leftWrist: { x: 0.43, y: 0.22 + wristDrop },
    rightWrist: { x: 0.57, y: 0.22 + wristDrop },
    leftHip: { x: 0.46, y: 0.5 },
    rightHip: { x: 0.54, y: 0.5 },
    leftKnee: { x: 0.46, y: 0.7 },
    rightKnee: { x: 0.54, y: 0.7 },
    leftAnkle: { x: 0.46, y: 0.88 },
    rightAnkle: { x: 0.54, y: 0.88 },
  };
}

function plankSkeleton(shoulderY = 0.45, straightArms = true): Skeleton {
  // Floor camera facing the athlete. shoulderY sinks toward the wrists at the
  // bottom of a rep; bent arms push the elbows out sideways.
  const elbows: [Joint, Joint] = straightArms
    ? [{ x: 0.4, y: (shoulderY + 0.65) / 2 }, { x: 0.6, y: (shoulderY + 0.65) / 2 }]
    : [{ x: 0.25, y: (shoulderY + 0.65) / 2 }, { x: 0.75, y: (shoulderY + 0.65) / 2 }];
  return {
    nose: { x: 0.5, y: shoulderY - 0.05 },
    leftEye: { x: 0.48, y: shoulderY - 0.06 },
    rightEye: { x: 0.52, y: shoulderY - 0.06 },
    leftEar: { x: 0.46, y: shoulderY - 0.05 },
    rightEar: { x: 0.54, y: shoulderY - 0.05 },
    leftShoulder: { x: 0.4, y: shoulderY },
    rightShoulder: { x: 0.6, y: shoulderY },
    leftElbow: elbows[0],
    rightElbow: elbows[1],
    leftWrist: { x: 0.4, y: 0.65 },
    rightWrist: { x: 0.6, y: 0.65 },
    leftHip: { x: 0.45, y: 0.35 },
    rightHip: { x: 0.55, y: 0.35 },
    leftKnee: { x: 0.46, y: 0.25 },
    rightKnee: { x: 0.54, y: 0.25 },
    leftAnkle: { x: 0.46, y: 0.15 },
    rightAnkle: { x: 0.54, y: 0.15 },
  };
}

/** One pipeline tick, mirroring the usePoseSession wiring. */
function tick(
  detector: RepDetector,
  skeleton: Skeleton,
  nowMs: number,
): { canCount: boolean; repCount: number } {
  const frame: PoseFrame = { skeleton, normalized: skeleton, visibility: makeVisibility() };
  const depth = bodyExtension(skeleton, frame.visibility);

  const canCount = !isUprightExtended(skeleton, frame.visibility);

  if (canCount && depth !== null) {
    detector.update(depth, nowMs);
  }
  return { canCount, repCount: detector.getRepCount() };
}

/** Run `skeletons` in a loop for durationMs, cycling one skeleton per interval. */
function run(
  detector: RepDetector,
  skeletons: Skeleton[],
  durationMs: number,
  startMs: number,
  intervalMs = 700,
): number {
  let now = startMs;
  while (now - startMs < durationMs) {
    const idx = Math.floor((now - startMs) / intervalMs) % skeletons.length;
    tick(detector, skeletons[idx], now);
    now += DT;
  }
  return now;
}

describe('gate-free counting integration', () => {
  it('first push-up counts immediately — no readiness ritual', () => {
    const detector = new RepDetector();

    // Straight into plank push-ups from the first frame: no standing phase,
    // no top-position hold. The set counts from the first rep.
    run(detector, [plankSkeleton(0.45, true), plankSkeleton(0.58, false)], 8_000, 0);

    expect(detector.getRepCount()).toBeGreaterThanOrEqual(3);
  });

  it('field bug repro: standing person bending arms never counts a rep', () => {
    const detector = new RepDetector();

    // Standing with wrists oscillating (arm bends). bodyExtension stays far
    // above PLANK_DEPTH_MIN — the exact signal that once fooled counting; the
    // upright veto is what blocks it now.
    const depthStanding = bodyExtension(standingSkeleton(), makeVisibility());
    expect(depthStanding).not.toBeNull();
    expect(depthStanding as number).toBeGreaterThan(P.PLANK_DEPTH_MIN);

    // 30 seconds of standing "reps".
    run(detector, [standingSkeleton(0.26), standingSkeleton(0.1)], 30_000, 0);

    expect(detector.getRepCount()).toBe(0);
  });

  it('full session: push-ups count → stand up freezes → plank resumes', () => {
    const detector = new RepDetector();
    let now = 0;

    // 1) Push-ups: top ↔ bottom oscillation counts from the start.
    now = run(detector, [plankSkeleton(0.45, true), plankSkeleton(0.58, false)], 8_000, now);
    const midSetCount = detector.getRepCount();
    expect(midSetCount).toBeGreaterThanOrEqual(3);

    // 2) Stand up to rest: the upright veto keeps standing arm bends from
    // adding anything, but the count survives.
    now = run(detector, [standingSkeleton(0.26), standingSkeleton(0.1)], 10_000, now);
    expect(detector.getRepCount()).toBe(midSetCount);

    // 3) Back into plank — the count resumes immediately, no repeated checks.
    run(detector, [plankSkeleton(0.45, true), plankSkeleton(0.58, false)], 8_000, now);
    expect(detector.getRepCount()).toBeGreaterThan(midSetCount);
  });
});
