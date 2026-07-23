import { PUSHUP_PARAMS } from '../exercises/pushup.config';
import { PoseStabilizer } from '../poseStabilizer';
import type { RawPoint, RawPose, RenderPose } from '../types';

const P = PUSHUP_PARAMS;
const DT = 33; // ~30 fps
const N_POINTS = 12; // RENDER_POINTS length

function makePoint(x: number, y: number, overrides: Partial<RawPoint> = {}): RawPoint {
  return { x, y, present: true, offFrame: false, ...overrides };
}

/** Default pose: shoulders 100 px apart, everything present. */
function makeRaw(overrides: Record<number, Partial<RawPoint>> = {}): RawPose {
  const pts: RawPoint[] = [];
  for (let i = 0; i < N_POINTS; i++) {
    pts.push(makePoint(100 + (i % 2) * 100, 100 + Math.floor(i / 2) * 60));
  }
  for (const [idx, o] of Object.entries(overrides)) {
    pts[Number(idx)] = { ...pts[Number(idx)], ...o };
  }
  return { tier: 'FULL', pts };
}

/** Run identical frames for durationMs; returns every emitted pose. */
function runFrames(
  st: PoseStabilizer,
  raw: RawPose | null,
  durationMs: number,
  startMs: number,
): { poses: (RenderPose | null)[]; now: number } {
  const poses: (RenderPose | null)[] = [];
  let now = startMs;
  while (now - startMs < durationMs) {
    now += DT;
    poses.push(st.update(raw ?? { tier: 'NO_BODY', pts: [] }, raw !== null, now));
  }
  return { poses, now };
}

const WRIST = 4; // leftWrist index in RENDER_POINTS

describe('PoseStabilizer (issue 4)', () => {
  it('fades a new joint in — never pops to full opacity in one frame', () => {
    const st = new PoseStabilizer();
    const first = st.update(makeRaw(), true, 0);
    expect(first?.pts[WRIST].alpha).toBeLessThan(1);

    const { poses } = runFrames(st, makeRaw(), 1000, 0);
    expect(poses[poses.length - 1]?.pts[WRIST].alpha).toBe(1);
  });

  it('holds a lost joint at full alpha through the hold window (no blink)', () => {
    const st = new PoseStabilizer();
    let { now } = runFrames(st, makeRaw(), 1000, 0);

    // Joint drops out for a single frame — alpha and position must not move.
    const dropped = makeRaw({ [WRIST]: { present: false } });
    now += DT;
    const pose = st.update(dropped, true, now);
    expect(pose?.pts[WRIST].alpha).toBe(1);
    expect(pose?.pts[WRIST].show).toBe(true);
  });

  it('fades a joint out gradually after the hold window, never instantly', () => {
    const st = new PoseStabilizer();
    const { now } = runFrames(st, makeRaw(), 1000, 0);

    const dropped = makeRaw({ [WRIST]: { present: false } });
    const { poses } = runFrames(st, dropped, P.HOLD_BEFORE_FADE_MS + 2000, now);

    const alphas = poses.map(p => p!.pts[WRIST].alpha);
    // Monotonically non-increasing, per-frame drop bounded by the fade rate.
    const maxDrop = P.FADE_OUT_PER_S * (DT / 1000) + 1e-6;
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1]);
      expect(alphas[i - 1] - alphas[i]).toBeLessThanOrEqual(maxDrop);
    }
    // Ends invisible.
    expect(alphas[alphas.length - 1]).toBe(0);
    expect(poses[poses.length - 1]?.pts[WRIST].show).toBe(false);
  });

  it('caps a single-joint teleport while the body stays put', () => {
    const st = new PoseStabilizer();
    let { now } = runFrames(st, makeRaw(), 1000, 0);

    const before = st.update(makeRaw(), true, (now += DT))!.pts[WRIST];
    const jumped = makeRaw({ [WRIST]: { x: 900, y: 800 } });
    const after = st.update(jumped, true, (now += DT))!.pts[WRIST];

    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    // Shoulder width is 100 px, body did not move → cap ≈ TELEPORT_MAX_FRAC · 100.
    expect(moved).toBeLessThanOrEqual(P.TELEPORT_MAX_FRAC * 100 * 1.5);
    expect(moved).toBeLessThan(200); // nowhere near the 800+ px jump
  });

  it('does not clamp joints when the whole body moves', () => {
    const st = new PoseStabilizer();
    let { now } = runFrames(st, makeRaw(), 1000, 0);

    // Everything (including shoulders) shifts 300 px right in one frame.
    const shifted: RawPose = {
      tier: 'FULL',
      pts: makeRaw().pts.map(pt => ({ ...pt, x: pt.x + 300 })),
    };
    const pose = st.update(shifted, true, (now += DT))!;
    // Wrist followed the body without lagging behind.
    expect(pose.pts[WRIST].x).toBeGreaterThan(makeRaw().pts[WRIST].x + 250);
  });

  it('caps inferred joints at INFERRED_ALPHA so priors read as uncertain', () => {
    const st = new PoseStabilizer();
    const raw = makeRaw({ [WRIST]: { inferred: true } });
    const { poses } = runFrames(st, raw, 2000, 0);
    const alpha = poses[poses.length - 1]!.pts[WRIST].alpha;
    expect(alpha).toBeCloseTo(P.INFERRED_ALPHA, 5);
  });

  it('holds then fades the whole skeleton on body loss — no hard cutoff', () => {
    const st = new PoseStabilizer();
    const { now } = runFrames(st, makeRaw(), 1000, 0);

    const { poses } = runFrames(st, null, P.HOLD_BEFORE_FADE_MS + 2000, now);

    // Immediately after loss: still drawn at full alpha (hold).
    expect(poses[0]?.pts[WRIST].alpha).toBe(1);
    // Somewhere in the middle: drawn but fading.
    const mid = poses[Math.floor(poses.length / 2)];
    if (mid) {
      expect(mid.pts[WRIST].alpha).toBeLessThan(1);
    }
    // Eventually: gone entirely (null), and it stays gone.
    expect(poses[poses.length - 1]).toBeNull();
  });

  it('reappearing after a fade never jumps straight back to full alpha', () => {
    const st = new PoseStabilizer();
    let { now } = runFrames(st, makeRaw(), 1000, 0);
    ({ now } = runFrames(
      st,
      makeRaw({ [WRIST]: { present: false } }),
      P.HOLD_BEFORE_FADE_MS + 300,
      now,
    ));
    const fadedAlpha = st.update(
      makeRaw({ [WRIST]: { present: false } }),
      true,
      (now += DT),
    )!.pts[WRIST].alpha;
    expect(fadedAlpha).toBeLessThan(1);

    const back = st.update(makeRaw(), true, (now += DT))!.pts[WRIST].alpha;
    expect(back).toBeGreaterThan(fadedAlpha);
    expect(back).toBeLessThanOrEqual(fadedAlpha + P.FADE_IN_PER_S * (DT / 1000) + 1e-6);
  });
});
