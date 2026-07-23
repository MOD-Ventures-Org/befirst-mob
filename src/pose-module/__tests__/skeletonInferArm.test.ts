import { buildRenderPose, RENDER_POINTS } from '../skeleton';
import type { JointVisibility, Skeleton } from '../types';

// Issue 6 reproduction — "arms in triangle".
//
// When elbows/wrists are not confidently tracked, inferArm() draws default
// arms hanging down and OUTWARD from each shoulder (spec §7 / review Issue 6:
// "defaulting OUTWARD — away from the body's midline ... never pointing
// inward, never crossing toward the middle").
//
// The outward sign is currently derived from the ANATOMICAL side label
// ('left' → +OUT_ANGLE_DEG). Whether the anatomical left shoulder appears on
// screen-left or screen-right depends on camera mirroring:
//   - Android front camera (default "mirror-front-only"): person facing the
//     camera has their left shoulder on screen-LEFT → inferred arms outward ✓
//   - iOS (default "no-mirror"): person facing the camera has their left
//     shoulder on screen-RIGHT → the same sign now points INWARD, and the two
//     arms converge below the midline — the reported triangle ✗
//
// The spec property under test: inferred arms must point outward in SCREEN
// space regardless of which screen side each anatomical shoulder lands on.

const VIEW_W = 400;
const VIEW_H = 800;

const IDX = {
  leftShoulder: RENDER_POINTS.indexOf('leftShoulder'),
  rightShoulder: RENDER_POINTS.indexOf('rightShoulder'),
  leftElbow: RENDER_POINTS.indexOf('leftElbow'),
  rightElbow: RENDER_POINTS.indexOf('rightElbow'),
  leftWrist: RENDER_POINTS.indexOf('leftWrist'),
  rightWrist: RENDER_POINTS.indexOf('rightWrist'),
};

// Standing person, full body in frame. Only the shoulder x positions differ
// between the two scenarios.
function makeFrame(leftShoulderX: number, rightShoulderX: number) {
  const midX = (leftShoulderX + rightShoulderX) / 2;
  const view: Skeleton = {
    nose: { x: midX, y: 120 },
    leftEye: { x: midX - 10, y: 110 },
    rightEye: { x: midX + 10, y: 110 },
    leftEar: { x: midX - 20, y: 115 },
    rightEar: { x: midX + 20, y: 115 },
    leftShoulder: { x: leftShoulderX, y: 200 },
    rightShoulder: { x: rightShoulderX, y: 200 },
    // Elbows/wrists deliberately garbage — they are low-confidence and must
    // be replaced by the inferred arm.
    leftElbow: { x: midX, y: 400 },
    rightElbow: { x: midX, y: 400 },
    leftWrist: { x: midX, y: 450 },
    rightWrist: { x: midX, y: 450 },
    leftHip: { x: leftShoulderX * 0.75 + midX * 0.25, y: 420 },
    rightHip: { x: rightShoulderX * 0.75 + midX * 0.25, y: 420 },
    leftKnee: { x: leftShoulderX * 0.75 + midX * 0.25, y: 580 },
    rightKnee: { x: rightShoulderX * 0.75 + midX * 0.25, y: 580 },
    leftAnkle: { x: leftShoulderX * 0.75 + midX * 0.25, y: 720 },
    rightAnkle: { x: rightShoulderX * 0.75 + midX * 0.25, y: 720 },
  };

  const normalized = Object.fromEntries(
    Object.entries(view).map(([j, p]) => [j, { x: p.x / VIEW_W, y: p.y / VIEW_H }]),
  ) as unknown as Skeleton;

  const visibility: JointVisibility = {
    nose: 0.9,
    leftEye: 0.9,
    rightEye: 0.9,
    leftEar: 0.9,
    rightEar: 0.9,
    leftShoulder: 0.9,
    rightShoulder: 0.9,
    leftElbow: 0.1, // arm not tracked → inference must kick in
    rightElbow: 0.1,
    leftWrist: 0.1,
    rightWrist: 0.1,
    leftHip: 0.9,
    rightHip: 0.9,
    leftKnee: 0.9,
    rightKnee: 0.9,
    leftAnkle: 0.9,
    rightAnkle: 0.9,
  };

  return { view, normalized, visibility, midX };
}

// Outward = the joint sits farther from the torso midline than its shoulder,
// on the same screen side as that shoulder.
function expectArmOutward(
  pts: { x: number; y: number }[],
  shoulderIdx: number,
  elbowIdx: number,
  wristIdx: number,
  midX: number,
) {
  const shoulder = pts[shoulderIdx];
  const outwardSign = Math.sign(shoulder.x - midX);
  expect(Math.sign(pts[elbowIdx].x - shoulder.x)).toBe(outwardSign);
  expect(Math.sign(pts[wristIdx].x - shoulder.x)).toBe(outwardSign);
  // And below the shoulder (hanging down), not floating up.
  expect(pts[elbowIdx].y).toBeGreaterThan(shoulder.y);
  expect(pts[wristIdx].y).toBeGreaterThan(pts[elbowIdx].y);
}

describe('Issue 6 — inferred default arms must point outward in screen space', () => {
  it('mirrored view (Android front camera): anatomical left shoulder on screen-left', () => {
    const { view, normalized, visibility, midX } = makeFrame(100, 300);
    const pose = buildRenderPose(view, normalized, visibility, 'FULL');

    expectArmOutward(pose.pts, IDX.leftShoulder, IDX.leftElbow, IDX.leftWrist, midX);
    expectArmOutward(pose.pts, IDX.rightShoulder, IDX.rightElbow, IDX.rightWrist, midX);
  });

  it('unmirrored view (iOS front camera, person facing it): anatomical left shoulder on screen-right', () => {
    const { view, normalized, visibility, midX } = makeFrame(300, 100);
    const pose = buildRenderPose(view, normalized, visibility, 'FULL');

    expectArmOutward(pose.pts, IDX.leftShoulder, IDX.leftElbow, IDX.leftWrist, midX);
    expectArmOutward(pose.pts, IDX.rightShoulder, IDX.rightElbow, IDX.rightWrist, midX);
  });

  it('inferred wrists never cross toward each other (no converging triangle)', () => {
    for (const [l, r] of [
      [100, 300],
      [300, 100],
    ]) {
      const { view, normalized, visibility } = makeFrame(l, r);
      const pose = buildRenderPose(view, normalized, visibility, 'FULL');
      const wristGap = Math.abs(pose.pts[IDX.leftWrist].x - pose.pts[IDX.rightWrist].x);
      const shoulderGap = Math.abs(
        pose.pts[IDX.leftShoulder].x - pose.pts[IDX.rightShoulder].x,
      );
      expect(wristGap).toBeGreaterThanOrEqual(shoulderGap);
    }
  });
});
