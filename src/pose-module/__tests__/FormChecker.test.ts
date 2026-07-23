import { FormChecker } from '../services/FormChecker';
import type {
  ExerciseConfig,
  FormRule,
  JointAngles,
  Skeleton,
} from '../types';

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

/** Minimal rule — only code and check are required, rest are safe defaults. */
function makeRule(
  overrides: Partial<FormRule> & Pick<FormRule, 'code' | 'check'>,
): FormRule {
  return {
    activePhases: ['MOVING_DOWN'],
    joints: ['leftElbow'],
    isCritical: false,
    persistent: true,
    ...overrides,
  };
}

/** Config whose only variable part is the formRules array. */
function makeConfig(formRules: FormRule[]): ExerciseConfig {
  return {
    id: 'test',
    phases: ['WAITING', 'MOVING_DOWN', 'TOP'],
    countsRepOnTransitionTo: 'TOP',
    phaseTimeoutFrames: 10,
    transitions: {},
    formRules,
  };
}

describe('FormChecker.evaluate', () => {
  describe('phase filtering', () => {
    it('skips a rule whose activePhases does not include the current phase', () => {
      // Rule is only active in BOTTOM, but we evaluate in MOVING_DOWN
      const rule = makeRule({ code: 'R1', activePhases: ['BOTTOM'], check: () => false });
      const checker = new FormChecker(makeConfig([rule]));

      const result = checker.evaluate('MOVING_DOWN', makeAngles(), makeSkeleton());
      expect(result.violations).toHaveLength(0);
      expect(result.passedCodes.has('R1')).toBe(false);
    });

    it('evaluates a rule when the current phase is in its activePhases', () => {
      const rule = makeRule({
        code: 'R1',
        activePhases: ['MOVING_DOWN'],
        check: () => false,
      });
      const checker = new FormChecker(makeConfig([rule]));

      const result = checker.evaluate('MOVING_DOWN', makeAngles(), makeSkeleton());

      expect(result.violations).toHaveLength(1);
    });

    it('evaluates multiple active phases correctly', () => {
      const rule = makeRule({
        code: 'R1',
        activePhases: ['MOVING_DOWN', 'TOP'],
        check: () => false,
      });
      const checker = new FormChecker(makeConfig([rule]));

      expect(
        checker.evaluate('MOVING_DOWN', makeAngles(), makeSkeleton()).violations,
      ).toHaveLength(1);
      expect(
        checker.evaluate('TOP', makeAngles(), makeSkeleton()).violations,
      ).toHaveLength(1);
      expect(
        checker.evaluate('WAITING', makeAngles(), makeSkeleton()).violations,
      ).toHaveLength(0);
    });
  });

  describe('passing rule', () => {
    it('returns no violations', () => {
      const rule = makeRule({ code: 'R1', check: () => true });
      const result = new FormChecker(makeConfig([rule])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.violations).toHaveLength(0);
    });

    it('adds the code to passedCodes', () => {
      const rule = makeRule({ code: 'R1', check: () => true });
      const result = new FormChecker(makeConfig([rule])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.passedCodes.has('R1')).toBe(true);
    });
  });

  describe('failing rule', () => {
    it('adds a violation', () => {
      const rule = makeRule({ code: 'R1', check: () => false });
      const result = new FormChecker(makeConfig([rule])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.violations).toHaveLength(1);
    });

    it('does not add the code to passedCodes', () => {
      const rule = makeRule({ code: 'R1', check: () => false });
      const result = new FormChecker(makeConfig([rule])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.passedCodes.has('R1')).toBe(false);
    });

    it('populates all violation fields from the rule and current phase', () => {
      const rule = makeRule({
        code: 'BACK_NOT_FLAT',
        joints: ['leftHip', 'rightHip'],
        isCritical: true,
        check: () => false,
      });

      const result = new FormChecker(makeConfig([rule])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      const v = result.violations[0];
      expect(v.code).toBe('BACK_NOT_FLAT');
      expect(v.joints).toEqual(['leftHip', 'rightHip']);
      expect(v.phase).toBe('MOVING_DOWN');
      expect(v.isCritical).toBe(true);
    });
  });

  describe('rule inputs', () => {
    it('passes the current angles and skeleton into the check function', () => {
      let capturedAngles: JointAngles | undefined;
      let capturedSkeleton: Skeleton | undefined;

      const rule = makeRule({
        code: 'R1',
        check: (a, s) => {
          capturedAngles = a;
          capturedSkeleton = s;
          return true;
        },
      });

      const angles = makeAngles({ leftElbow: 45 });
      const skeleton = makeSkeleton({ nose: { x: 99, y: 99 } });

      new FormChecker(makeConfig([rule])).evaluate('MOVING_DOWN', angles, skeleton);

      expect(capturedAngles?.leftElbow).toBe(45);
      expect(capturedSkeleton?.nose).toEqual({ x: 99, y: 99 });
    });
  });

  describe('jointStatus', () => {
    it("marks referenced joints 'pass' when their rule passes", () => {
      const rule = makeRule({
        code: 'R1',
        joints: ['leftElbow', 'rightElbow'],
        check: () => true,
      });
      const result = new FormChecker(makeConfig([rule])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.jointStatus.leftElbow).toBe('pass');
      expect(result.jointStatus.rightElbow).toBe('pass');
    });

    it("marks referenced joints 'fail' when their rule fails", () => {
      const rule = makeRule({
        code: 'R1',
        joints: ['leftElbow', 'rightElbow'],
        check: () => false,
      });

      const result = new FormChecker(makeConfig([rule])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.jointStatus.leftElbow).toBe('fail');
      expect(result.jointStatus.rightElbow).toBe('fail');
    });

    it("leaves joints 'inactive' when no active rule references them", () => {
      const rule = makeRule({ code: 'R1', joints: ['leftElbow'], check: () => true });
      const result = new FormChecker(makeConfig([rule])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.jointStatus.leftElbow).toBe('pass'); // referenced
      expect(result.jointStatus.leftKnee).toBe('inactive'); // not referenced
      expect(result.jointStatus.nose).toBe('inactive');
    });

    it("'fail' takes precedence over 'pass' on the same joint", () => {
      // Two rules target leftElbow: one passes, one fails.
      // The joint should end up 'fail' regardless of evaluation order.
      const passing = makeRule({
        code: 'R_PASS',
        joints: ['leftElbow'],
        check: () => true,
      });
      const failing = makeRule({
        code: 'R_FAIL',
        joints: ['leftElbow'],
        check: () => false,
      });

      const resultA = new FormChecker(makeConfig([failing, passing])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );
      const resultB = new FormChecker(makeConfig([passing, failing])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(resultA.jointStatus.leftElbow).toBe('fail');
      expect(resultB.jointStatus.leftElbow).toBe('fail');
    });
  });

  describe('multiple rules', () => {
    it('evaluates all active rules independently', () => {
      const passing = makeRule({
        code: 'R_PASS',
        joints: ['leftShoulder'],
        check: () => true,
      });
      const failing = makeRule({
        code: 'R_FAIL',
        joints: ['leftElbow'],
        check: () => false,
      });

      const result = new FormChecker(makeConfig([passing, failing])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.violations.map(v => v.code)).toEqual(['R_FAIL']);
      expect(result.passedCodes.has('R_PASS')).toBe(true);
      expect(result.passedCodes.has('R_FAIL')).toBe(false);
    });
  });

  describe('empty form rules', () => {
    it('returns empty violations, empty passedCodes, and all joints inactive', () => {
      const result = new FormChecker(makeConfig([])).evaluate(
        'MOVING_DOWN',
        makeAngles(),
        makeSkeleton(),
      );

      expect(result.violations).toHaveLength(0);
      expect(result.passedCodes.size).toBe(0);
      expect(result.jointStatus.leftElbow).toBe('inactive');
      expect(result.jointStatus.nose).toBe('inactive');
    });
  });
});
