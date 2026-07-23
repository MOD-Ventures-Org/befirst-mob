import { PUSHUP_PARAMS } from '../exercises/pushup.config';
import { SubjectLock } from '../subjectLock';
import type { Joint, JointVisibility, Skeleton } from '../types';

const P = PUSHUP_PARAMS;
const DT = 33;

// Only the shoulders matter to the lock; everything else is filler.
function makeSkeleton(midX: number, midY: number, width: number): Skeleton {
  const j = (x: number, y: number): Joint => ({ x, y });
  const filler = j(midX, midY + 200);
  return {
    nose: j(midX, midY - 50),
    leftEye: filler,
    rightEye: filler,
    leftEar: filler,
    rightEar: filler,
    leftShoulder: j(midX - width / 2, midY),
    rightShoulder: j(midX + width / 2, midY),
    leftElbow: filler,
    rightElbow: filler,
    leftWrist: filler,
    rightWrist: filler,
    leftHip: filler,
    rightHip: filler,
    leftKnee: filler,
    rightKnee: filler,
    leftAnkle: filler,
    rightAnkle: filler,
  };
}

function makeVisibility(shoulderConf = 0.9): JointVisibility {
  const v = {} as JointVisibility;
  for (const joint of Object.keys(makeSkeleton(0, 0, 1)) as (keyof Skeleton)[]) {
    v[joint] = 0.9;
  }
  v.leftShoulder = shoulderConf;
  v.rightShoulder = shoulderConf;
  return v;
}

describe('SubjectLock (issue 3)', () => {
  it('locks onto the first confident detection', () => {
    const lock = new SubjectLock();
    expect(lock.update(makeSkeleton(300, 400, 100), makeVisibility(), 0)).toBe(true);
  });

  it('accepts continuous human motion and follows it across the frame', () => {
    const lock = new SubjectLock();
    let now = 0;
    // Walk the subject 600 px in 60 small steps — every frame must be accepted.
    for (let i = 0; i <= 60; i++) {
      const ok = lock.update(makeSkeleton(300 + i * 10, 400, 100), makeVisibility(), now);
      expect(ok).toBe(true);
      now += DT;
    }
  });

  it('rejects a teleporting detection and keeps the original lock', () => {
    const lock = new SubjectLock();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      lock.update(makeSkeleton(300, 400, 100), makeVisibility(), (now += DT));
    }
    // Background shape 8 shoulder-widths away.
    expect(lock.update(makeSkeleton(1100, 400, 100), makeVisibility(), (now += DT))).toBe(false);
    // The real subject is still accepted right after.
    expect(lock.update(makeSkeleton(302, 401, 100), makeVisibility(), (now += DT))).toBe(true);
  });

  it('rejects a wildly rescaled detection (person-sized vs background shape)', () => {
    const lock = new SubjectLock();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      lock.update(makeSkeleton(300, 400, 100), makeVisibility(), (now += DT));
    }
    expect(lock.update(makeSkeleton(300, 400, 100 * (P.SUBJECT_SCALE_MAX + 0.2)), makeVisibility(), (now += DT))).toBe(false);
    expect(lock.update(makeSkeleton(300, 400, 100 / (P.SUBJECT_SCALE_MAX + 0.2)), makeVisibility(), (now += DT))).toBe(false);
  });

  it('re-locks after a sustained rejection streak', () => {
    const lock = new SubjectLock();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      lock.update(makeSkeleton(300, 400, 100), makeVisibility(), (now += DT));
    }
    // A far detection keeps getting rejected...
    while (now < 10 * DT + P.SUBJECT_RELOCK_MS) {
      lock.update(makeSkeleton(1100, 400, 100), makeVisibility(), (now += DT));
    }
    // ...until the lock goes stale and adopts it as the new subject.
    expect(lock.update(makeSkeleton(1100, 400, 100), makeVisibility(), (now += DT))).toBe(true);
  });

  it('recognizes the subject after a dropout even if it moved meanwhile', () => {
    const lock = new SubjectLock();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      lock.update(makeSkeleton(300, 400, 100), makeVisibility(), (now += DT));
    }
    // 1 s occlusion, subject re-appears 2.5 widths away — inside the
    // time-scaled drift allowance (SUBJECT_DRIFT_PER_S · 1 s = 3 widths).
    now += 1000;
    expect(lock.update(makeSkeleton(550, 400, 100), makeVisibility(), now)).toBe(true);
  });

  it('does not judge frames without confident shoulders', () => {
    const lock = new SubjectLock();
    let now = 0;
    for (let i = 0; i < 10; i++) {
      lock.update(makeSkeleton(300, 400, 100), makeVisibility(), (now += DT));
    }
    // Low-confidence shoulders anywhere on screen: passed through, not judged.
    expect(lock.update(makeSkeleton(1100, 400, 100), makeVisibility(0.2), (now += DT))).toBe(true);
    // The signature was not corrupted by that frame.
    expect(lock.update(makeSkeleton(1100, 400, 100), makeVisibility(), (now += DT))).toBe(false);
  });

  it('reset drops the lock', () => {
    const lock = new SubjectLock();
    lock.update(makeSkeleton(300, 400, 100), makeVisibility(), 0);
    lock.reset();
    // A totally different subject is adopted immediately after reset.
    expect(lock.update(makeSkeleton(1100, 400, 50), makeVisibility(), DT)).toBe(true);
  });
});
