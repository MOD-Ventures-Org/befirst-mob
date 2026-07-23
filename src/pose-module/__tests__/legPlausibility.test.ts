import { implausibleLegJoints } from '../plausibility';
import { buildRenderPose, RENDER_POINTS } from '../skeleton';
import type { Joint, JointVisibility, Skeleton } from '../types';

// Issue 7: anatomically impossible legs must never be drawn — they are
// demoted to not-present so the issue-4 chain fades them out.

// Upright person in view-space pixels; shoulder width 100.
function makeSkeleton(overrides: Partial<Record<keyof Skeleton, Joint>> = {}): Skeleton {
  const base: Skeleton = {
    nose: { x: 250, y: 60 },
    leftEye: { x: 240, y: 55 },
    rightEye: { x: 260, y: 55 },
    leftEar: { x: 230, y: 60 },
    rightEar: { x: 270, y: 60 },
    leftShoulder: { x: 200, y: 110 },
    rightShoulder: { x: 300, y: 110 },
    leftElbow: { x: 195, y: 175 },
    rightElbow: { x: 305, y: 175 },
    leftWrist: { x: 190, y: 240 },
    rightWrist: { x: 310, y: 240 },
    leftHip: { x: 215, y: 250 },
    rightHip: { x: 285, y: 250 },
    leftKnee: { x: 215, y: 350 },
    rightKnee: { x: 285, y: 350 },
    leftAnkle: { x: 215, y: 440 },
    rightAnkle: { x: 285, y: 440 },
  };
  return { ...base, ...overrides };
}

function makeVisibility(value = 0.9, overrides: Partial<JointVisibility> = {}): JointVisibility {
  const v = {} as JointVisibility;
  for (const j of Object.keys(makeSkeleton()) as (keyof Skeleton)[]) v[j] = value;
  return { ...v, ...overrides };
}

describe('implausibleLegJoints (issue 7)', () => {
  it('accepts a normal standing pose', () => {
    expect(implausibleLegJoints(makeSkeleton(), makeVisibility()).size).toBe(0);
  });

  it('rejects a knee detected inside the torso', () => {
    // Torso spans x 200–300, y 110–250; put the knee dead center.
    const s = makeSkeleton({ leftKnee: { x: 250, y: 180 } });
    const bad = implausibleLegJoints(s, makeVisibility());
    expect(bad.has('leftKnee')).toBe(true);
    // The shin would hang from a rejected knee — the ankle goes with it.
    expect(bad.has('leftAnkle')).toBe(true);
    expect(bad.has('rightKnee')).toBe(false);
  });

  it('rejects an ankle detected inside the torso', () => {
    const s = makeSkeleton({ rightAnkle: { x: 250, y: 200 } });
    const bad = implausibleLegJoints(s, makeVisibility());
    expect(bad.has('rightAnkle')).toBe(true);
    expect(bad.has('rightKnee')).toBe(false);
  });

  it('rejects impossible thigh length', () => {
    // Thigh 5× shoulder width — no human proportion.
    const s = makeSkeleton({ leftKnee: { x: 215, y: 750 } });
    const bad = implausibleLegJoints(s, makeVisibility());
    expect(bad.has('leftKnee')).toBe(true);
  });

  it('rejects impossible shin length', () => {
    const s = makeSkeleton({ rightAnkle: { x: 285, y: 950 } });
    const bad = implausibleLegJoints(s, makeVisibility());
    expect(bad.has('rightAnkle')).toBe(true);
  });

  it('does not judge low-confidence leg joints (confidence pipeline owns them)', () => {
    const s = makeSkeleton({ leftKnee: { x: 250, y: 180 } });
    const bad = implausibleLegJoints(s, makeVisibility(0.9, { leftKnee: 0.2 }));
    expect(bad.has('leftKnee')).toBe(false);
  });

  it('skips the occlusion test when the torso itself is not confident', () => {
    const s = makeSkeleton({ leftKnee: { x: 250, y: 180 } });
    const bad = implausibleLegJoints(
      s,
      makeVisibility(0.9, { leftHip: 0.2, rightHip: 0.2 }),
    );
    // No torso → no occlusion judgment; length rules still apply but pass here.
    expect(bad.has('leftKnee')).toBe(false);
  });

  it('tolerates joints just at the torso edge (shrunk polygon)', () => {
    // On the hip line between the hips (inside the UNSHRUNK torso quad) with
    // a plausible thigh length — the shrunk polygon must NOT reject it.
    const s = makeSkeleton({ leftKnee: { x: 260, y: 250 } });
    expect(implausibleLegJoints(s, makeVisibility()).has('leftKnee')).toBe(false);
  });
});

describe('buildRenderPose demotes impossible legs (issue 7)', () => {
  const LEFT_KNEE = RENDER_POINTS.indexOf('leftKnee');
  const LEFT_ANKLE = RENDER_POINTS.indexOf('leftAnkle');

  it('a knee inside the torso is not-present and uncertain in the raw pose', () => {
    const s = makeSkeleton({ leftKnee: { x: 250, y: 180 } });
    const pose = buildRenderPose(s, normalize(s), makeVisibility(), 'FULL');
    expect(pose.pts[LEFT_KNEE].present).toBe(false);
    expect(pose.pts[LEFT_KNEE].uncertain).toBe(true);
    expect(pose.pts[LEFT_ANKLE].present).toBe(false);
  });

  it('normal legs stay present', () => {
    const s = makeSkeleton();
    const pose = buildRenderPose(s, normalize(s), makeVisibility(), 'FULL');
    expect(pose.pts[LEFT_KNEE].present).toBe(true);
    expect(pose.pts[LEFT_ANKLE].present).toBe(true);
  });

  // buildRenderPose judges presence on normalized [0,1] coords.
  function normalize(s: Skeleton): Skeleton {
    const out = {} as Skeleton;
    for (const j of Object.keys(s) as (keyof Skeleton)[]) {
      out[j] = { x: s[j].x / 500, y: s[j].y / 1000 };
    }
    return out;
  }
});
