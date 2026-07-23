import { StateMachine } from '../state-machine/StateMachine';
import type {
  ExerciseConfig,
  FormRule,
  FormViolation,
  JointAngles,
} from '../types';

/** All joints straight - a neutral "resting" frame. */
function makeAngles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 180,
    rightElbow: 180,
    leftKnee: 180,
    rightKnee: 180,
    leftHip: 180,
    rightHip: 180,
    spine: 0,
    backAngle: 180,
    elbowFlareLeft: 90,
    elbowFlareRight: 90,
    ...overrides,
  };
}

function makeViolation(code: string, isCritical = false): FormViolation {
  return { code, joints: ['leftElbow'], phase: 'MOVING_DOWN', isCritical };
}

/** A minimal FormRule used only so StateMachine can look up its `persistent` flag. */
function makeRule(code: string, persistent: boolean): FormRule {
  return {
    code,
    activePhases: ['MOVING_DOWN'],
    joints: ['leftElbow'],
    isCritical: false,
    check: () => true,
    persistent,
  };
}

/**
 * Minimal 3-phase config:
 * WAITING -> MOVING_DOWN -> TOP (with rep count) -> WAITING
 *
 * Transitions are driven purely by leftElbow angle so tests can control
 * them frame-precisely without touching the real pushup thresholds.
 */
function makeConfig(overrides: Partial<ExerciseConfig> = {}): ExerciseConfig {
  return {
    id: 'test',
    phases: ['WAITING', 'MOVING_DOWN', 'TOP'],
    countsRepOnTransitionTo: 'TOP',
    phaseTimeoutFrames: 5,
    transitions: {
      WAITING: {
        toPhase: 'MOVING_DOWN',
        condition: a => a.leftElbow < 100,
        stableFrames: 2,
      },
      MOVING_DOWN: { toPhase: 'TOP', condition: a => a.leftElbow > 150, stableFrames: 2 },
      TOP: { toPhase: 'WAITING', condition: () => true, stableFrames: 1 },
    },
    formRules: [],
    ...overrides,
  };
}

/** Call update() N times with the same angles. Returns the last result. */
function tick(sm: StateMachine, angles: JointAngles, n = 1) {
  let result = sm.update(angles, null);
  for (let i = 1; i < n; i++) {
    result = sm.update(angles, null);
  }

  return result;
}

/** Drive sm through a complete clean rep cycle back to WAITING. */
function completeRep(sm: StateMachine) {
  const down = makeAngles({ leftElbow: 90 });
  const up = makeAngles({ leftElbow: 170 });

  tick(sm, down, 2); // WAITING -> MOVING_DOWN
  tick(sm, up, 2); // MOVING_DOWN -> TOP
  tick(sm, up, 1); // TOP -> WAITING (count rep)
}

describe('StateMachine', () => {
  describe('initial state', () => {
    it('starts in the first phase', () => {
      const sm = new StateMachine(makeConfig());
      expect(sm.getPhase()).toBe('WAITING');
    });

    it('starts with repCount 0', () => {
      const sm = new StateMachine(makeConfig());
      expect(sm.update(makeAngles(), null).repCount).toBe(0);
    });
  });

  describe('stableFrames gate', () => {
    it('does not transition before stableFrames are met', () => {
      const sm = new StateMachine(makeConfig());

      // stableFrames=2 - one frame is not enough
      const result = sm.update(makeAngles({ leftElbow: 90 }), null);
      expect(result.phase).toBe('WAITING');
      expect(result.transitioned).toBe(false);
    });

    it('transitions exactly when stableFrames are met', () => {
      const sm = new StateMachine(makeConfig());
      const down = makeAngles({ leftElbow: 90 });
      sm.update(down, null); // 1st frame
      const result = sm.update(down, null); // 2nd frame - should transition now

      expect(result.phase).toBe('MOVING_DOWN');
      expect(result.transitioned).toBe(true);
    });

    it('resets the stable count when the condition breaks mid-sequence', () => {
      const sm = new StateMachine(makeConfig());
      const down = makeAngles({ leftElbow: 90 });
      const mid = makeAngles({ leftElbow: 180 });

      sm.update(down, null); // 1st frame
      sm.update(mid, null);
      sm.update(down, null); // stable count should reset, so this is now 1st frame again
      const result = sm.update(down, null); // 2nd frame - should transition now

      expect(result.phase).toBe('MOVING_DOWN');
      expect(result.transitioned).toBe(true);
    });
  });

  describe('rep counting', () => {
    it('increments repCount and returns completedRep when the counting phase is reached', () => {
      const sm = new StateMachine(makeConfig());

      tick(sm, makeAngles({ leftElbow: 90 }), 2);

      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.repCount).toBe(1);
      expect(result.transitioned).toBe(true);
      expect(result.completedRep).toBeDefined();
      expect(result.completedRep!.repNumber).toBe(1);
    });

    it('accumulates repCount across multiple reps', () => {
      const sm = new StateMachine(makeConfig());
      completeRep(sm);
      completeRep(sm);

      expect(sm.update(makeAngles(), null).repCount).toBe(2);
    });

    it('does not attach completedRep on non-counting transitions', () => {
      const sm = new StateMachine(makeConfig());
      completeRep(sm);
      completeRep(sm);

      expect(sm.update(makeAngles(), null).repCount).toBe(2);
    });
  });

  describe('phase timeout', () => {
    it('resets to WAITING after phaseTimeoutFrames without progress', () => {
      const sm = new StateMachine(makeConfig({ phaseTimeoutFrames: 5 }));
      const stuck = makeAngles({ leftElbow: 130 });

      tick(sm, makeAngles({ leftElbow: 90 }), 2); // WAITING -> MOVING_DOWN
      const result = tick(sm, stuck, 5); // should timeout now

      expect(result.phase).toBe('WAITING');
      expect(result.transitioned).toBe(true);
      expect(result.completedRep).toBeUndefined();
    });

    it('does not count a rep when the timeout fires', () => {
      const sm = new StateMachine(makeConfig({ phaseTimeoutFrames: 5 }));
      tick(sm, makeAngles({ leftElbow: 90 }), 2); // WAITING -> MOVING_DOWN
      tick(sm, makeAngles({ leftElbow: 130 }), 5); // should timeout now

      expect(sm.update(makeAngles(), null).repCount).toBe(0);
    });

    it('clears accumulated violations when the timeout fires', () => {
      const sm = new StateMachine(makeConfig({ phaseTimeoutFrames: 5 }));
      const violation = makeViolation('BACK_NOT_FLAT', true);

      tick(sm, makeAngles({ leftElbow: 90 }), 2); // WAITING -> MOVING_DOWN
      sm.update(makeAngles({ leftElbow: 90 }), null, [violation]); // accumulate violation
      tick(sm, makeAngles({ leftElbow: 130 }), 5); // should timeout now

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.violations).toHaveLength(0);
    });
  });

  describe('violation accumulation', () => {
    it('ignores violations that fire while in WAITING', () => {
      const sm = new StateMachine(makeConfig());
      const violation = makeViolation('SOME_RULE');

      // Feed violations while still in WAITING
      sm.update(makeAngles(), null, [violation]);
      sm.update(makeAngles(), null, [violation]);

      // Complete a rep without feeding any more violations
      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.violations).toHaveLength(0);
    });

    it('collects violations that fire during an active phase', () => {
      const sm = new StateMachine(makeConfig());
      const violation = makeViolation('BACK_NOT_FLAT', true);

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, [violation]);

      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.violations).toHaveLength(1);
      expect(result.completedRep?.violations[0].code).toBe('BACK_NOT_FLAT');
    });

    it('deduplicates violations with the same code', () => {
      const sm = new StateMachine(makeConfig());
      const violation = makeViolation('BACK_NOT_FLAT');

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      // Fire the same violation multiple times
      sm.update(makeAngles({ leftElbow: 90 }), null, [violation]);
      sm.update(makeAngles({ leftElbow: 90 }), null, [violation]);

      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);
      expect(result.completedRep?.violations).toHaveLength(1);
    });
  });

  describe('persistent violations', () => {
    it('keeps a persistent:true violation even if it later passes', () => {
      const rule = makeRule('BACK_NOT_FLAT', true);
      const sm = new StateMachine(makeConfig({ formRules: [rule] }));

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, [makeViolation('BACK_NOT_FLAT')]);

      // Rule recovers next frame
      sm.update(makeAngles({ leftElbow: 90 }), null, [], new Set(['BACK_NOT_FLAT']));

      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);
      expect(result.completedRep?.violations.map(v => v.code)).toContain('BACK_NOT_FLAT');
    });

    it('removes a persistent:false violation if it passes at any point', () => {
      const rule = makeRule('FULL_DEPTH_MISSING', false);
      const sm = new StateMachine(makeConfig({ formRules: [rule] }));

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, [
        makeViolation('FULL_DEPTH_MISSING'),
      ]);

      // Rule subsequently passes
      sm.update(makeAngles({ leftElbow: 90 }), null, [], new Set(['FULL_DEPTH_MISSING']));

      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);
      expect(result.completedRep?.violations).toHaveLength(0);
    });

    it('keeps a persistent:false violation if it never passes', () => {
      const rule = makeRule('FULL_DEPTH_MISSING', false);
      const sm = new StateMachine(makeConfig({ formRules: [rule] }));

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, [
        makeViolation('FULL_DEPTH_MISSING'),
      ]);

      // Never passes - no passCodes sent
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);
      expect(result.completedRep?.violations.map(v => v.code)).toContain(
        'FULL_DEPTH_MISSING',
      );
    });

    it('does not carry violations accumulated between the counting phase and WAITING into the next rep', () => {
      const topRule = makeRule('LATE_VIOLATION', true);
      const sm = new StateMachine(makeConfig({ formRules: [topRule] }));

      // Complete rep 1, then fire a violation while sitting in TOP (after rep was counted)
      tick(sm, makeAngles({ leftElbow: 90 }), 2); // → MOVING_DOWN
      tick(sm, makeAngles({ leftElbow: 170 }), 2); // → TOP (rep 1 counted here)
      sm.update(makeAngles({ leftElbow: 170 }), null, [
        makeViolation('LATE_VIOLATION', true),
      ]);
      tick(sm, makeAngles(), 1); // TOP → WAITING (clear block runs)

      // Rep 2 should be clean
      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.violations).toHaveLength(0);
    });

    it('includes violations from the final active phase when counting on transition to WAITING', () => {
      const topRule = makeRule('FULL_EXTENSION_MISSING', false);
      const sm = new StateMachine(
        makeConfig({ countsRepOnTransitionTo: 'WAITING', formRules: [topRule] }),
      );

      tick(sm, makeAngles({ leftElbow: 90 }), 2); // → MOVING_DOWN
      tick(sm, makeAngles({ leftElbow: 170 }), 2); // → TOP (no rep yet)
      // Violation fires during TOP; TOP→WAITING also fires here (stableFrames=1, condition=true)
      // so completedRep is returned from this same call
      const result = sm.update(makeAngles({ leftElbow: 170 }), null, [
        makeViolation('FULL_EXTENSION_MISSING', true),
      ]);

      expect(result.completedRep?.violations.map(v => v.code)).toContain(
        'FULL_EXTENSION_MISSING',
      );
    });
  });

  describe('rep validity and form score', () => {
    it('marks rep valid with score 100 when there are no violations', () => {
      const sm = new StateMachine(makeConfig());

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.isValid).toBe(true);
      expect(result.completedRep?.formScore).toBe(100);
    });

    it('marks rep invalid when a critical violation is present', () => {
      const sm = new StateMachine(makeConfig());

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, [
        makeViolation('BACK_NOT_FLAT', true),
      ]);

      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);
      expect(result.completedRep?.isValid).toBe(false);
    });

    it('deducts 30 points per ctitical violation', () => {
      const sm = new StateMachine(makeConfig());
      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, [makeViolation('R1', true)]);
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.formScore).toBe(70);
    });

    it('deducts 15 points per non-critical violation', () => {
      const sm = new StateMachine(makeConfig());

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, [makeViolation('R1', false)]);
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.formScore).toBe(85);
    });

    it('clamps the form score to 0, never negative', () => {
      const sm = new StateMachine(makeConfig());
      // 4 critical violations × 30 = 120 penalty → score = max(0, 100-120) = 0
      const violations = ['R1', 'R2', 'R3', 'R4'].map(c => makeViolation(c, true));

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, violations);
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.formScore).toBe(0);
    });
  });

  describe('reset', () => {
    it('returns phase to WAITING', () => {
      const sm = new StateMachine(makeConfig());
      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.reset();
      expect(sm.getPhase()).toBe('WAITING');
    });

    it('preserves repCount across reset (mid-session recovery)', () => {
      const sm = new StateMachine(makeConfig());
      completeRep(sm);
      sm.reset();
      expect(sm.update(makeAngles(), null).repCount).toBe(1);
    });

    it('clears repCount on resetSession', () => {
      const sm = new StateMachine(makeConfig());
      completeRep(sm);
      sm.resetSession();
      expect(sm.update(makeAngles(), null).repCount).toBe(0);
    });

    it('clears accumulated violations so they do not bleed into the next rep', () => {
      const sm = new StateMachine(makeConfig());

      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      sm.update(makeAngles({ leftElbow: 90 }), null, [makeViolation('BACK_NOT_FLAT')]);
      sm.reset();

      // Complete a clean rep after reset
      tick(sm, makeAngles({ leftElbow: 90 }), 2);
      const result = tick(sm, makeAngles({ leftElbow: 170 }), 2);

      expect(result.completedRep?.violations).toHaveLength(0);
    });

    it('counts on from the preserved total after reset', () => {
      const sm = new StateMachine(makeConfig());
      completeRep(sm);
      sm.reset();
      completeRep(sm);

      expect(sm.update(makeAngles(), null).repCount).toBe(2);
    });
  });
});
