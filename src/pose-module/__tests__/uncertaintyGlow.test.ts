import { PUSHUP_PARAMS } from '../exercises/pushup.config';
import { PoseStabilizer } from '../poseStabilizer';
import { buildRenderPose, RENDER_POINTS } from '../skeleton';
import type { Joint, JointVisibility, RawPoint, RawPose, Skeleton } from '../types';

// Issue 5: uncertainty must flow detection → RawPoint → RenderPoint so the
// overlay can glow exactly the joints the system is unsure about.

function makeSkeleton(): Skeleton {
  const j = (x: number, y: number): Joint => ({ x, y });
  return {
    nose: j(0.5, 0.4),
    leftEye: j(0.48, 0.39),
    rightEye: j(0.52, 0.39),
    leftEar: j(0.46, 0.4),
    rightEar: j(0.54, 0.4),
    leftShoulder: j(0.4, 0.45),
    rightShoulder: j(0.6, 0.45),
    leftElbow: j(0.4, 0.55),
    rightElbow: j(0.6, 0.55),
    leftWrist: j(0.4, 0.65),
    rightWrist: j(0.6, 0.65),
    leftHip: j(0.45, 0.35),
    rightHip: j(0.55, 0.35),
    leftKnee: j(0.46, 0.25),
    rightKnee: j(0.54, 0.25),
    leftAnkle: j(0.46, 0.15),
    rightAnkle: j(0.54, 0.15),
  };
}

function makeVisibility(value = 0.9, overrides: Partial<JointVisibility> = {}): JointVisibility {
  const v = {} as JointVisibility;
  for (const joint of Object.keys(makeSkeleton()) as (keyof Skeleton)[]) {
    v[joint] = value;
  }
  return { ...v, ...overrides };
}

const LEFT_WRIST = RENDER_POINTS.indexOf('leftWrist');
const LEFT_SHOULDER = RENDER_POINTS.indexOf('leftShoulder');

describe('buildRenderPose uncertainty flag (issue 5)', () => {
  it('flags a drawable-but-untrusted joint as uncertain', () => {
    // 0.4 is above SHOW_CONF (drawable) but below EW_MIN (not trusted). The
    // knee has no inference path, so the raw point survives to the output
    // (a weak wrist would be replaced by the inferred arm, which is
    // `inferred: true` — uncertain by a different route).
    const LEFT_KNEE = RENDER_POINTS.indexOf('leftKnee');
    const s = makeSkeleton();
    const pose = buildRenderPose(s, s, makeVisibility(0.9, { leftKnee: 0.4 }), 'FULL');
    expect(pose.pts[LEFT_KNEE].present).toBe(true);
    expect(pose.pts[LEFT_KNEE].uncertain).toBe(true);
  });

  it('does not flag confidently tracked joints', () => {
    const s = makeSkeleton();
    const pose = buildRenderPose(s, s, makeVisibility(0.9), 'FULL');
    expect(pose.pts[LEFT_WRIST].uncertain).toBe(false);
    expect(pose.pts[LEFT_SHOULDER].uncertain).toBe(false);
  });
});

describe('PoseStabilizer uncertainty propagation (issue 5)', () => {
  const N = RENDER_POINTS.length;

  function makeRaw(overrides: Record<number, Partial<RawPoint>> = {}): RawPose {
    const pts: RawPoint[] = [];
    for (let i = 0; i < N; i++) {
      pts.push({
        x: 100 + (i % 2) * 100,
        y: 100 + Math.floor(i / 2) * 60,
        present: true,
        offFrame: false,
        uncertain: false,
      });
    }
    for (const [idx, o] of Object.entries(overrides)) {
      pts[Number(idx)] = { ...pts[Number(idx)], ...o };
    }
    return { tier: 'FULL', pts };
  }

  it('trusted joints render certain, low-confidence joints render uncertain', () => {
    const st = new PoseStabilizer();
    const pose = st.update(makeRaw({ [LEFT_WRIST]: { uncertain: true } }), true, 0)!;
    expect(pose.pts[LEFT_WRIST].uncertain).toBe(true);
    expect(pose.pts[LEFT_SHOULDER].uncertain).toBe(false);
  });

  it('held joints (not tracked this frame) render uncertain', () => {
    const st = new PoseStabilizer();
    st.update(makeRaw(), true, 0);
    const pose = st.update(makeRaw({ [LEFT_WRIST]: { present: false } }), true, 33)!;
    expect(pose.pts[LEFT_WRIST].uncertain).toBe(true);
  });

  it('inferred joints render uncertain', () => {
    const st = new PoseStabilizer();
    const pose = st.update(makeRaw({ [LEFT_WRIST]: { inferred: true } }), true, 0)!;
    expect(pose.pts[LEFT_WRIST].uncertain).toBe(true);
  });

  it('GLOW_ALPHA stays subtle', () => {
    // Guard against the debug aid drifting into an alarming solid overlay —
    // the review doc explicitly wants subtle, not red-alert.
    expect(PUSHUP_PARAMS.GLOW_ALPHA).toBeLessThanOrEqual(0.5);
  });
});
