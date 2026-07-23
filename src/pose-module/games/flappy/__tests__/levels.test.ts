import { LEVEL_1, parseFlappyLevel } from '../levels';

describe('parseFlappyLevel (slot format: 0 | N-down | N-top)', () => {
  it('parses slots into playable-height fractions', () => {
    const level = parseFlappyLevel('0,0,3-down,0,7-top,0,4-down');
    expect(level.bottomFrac).toEqual([0, 0, 0.3, 0, 0, 0, 0.4]);
    expect(level.topFrac).toEqual([0, 0, 0, 0, 0.7, 0, 0]);
    expect(level.hasPipe).toEqual([false, false, true, false, true, false, true]);
  });

  it('accepts newlines and spaces as separators', () => {
    const level = parseFlappyLevel('0, 0\n3-down\n0 , 5-top');
    expect(level.hasPipe).toEqual([false, false, true, false, true]);
  });

  it('skips # comment lines (product level files carry the doc inline)', () => {
    const level = parseFlappyLevel('# sample level\n0,0,\n# a floor pipe next\n3-down');
    expect(level.hasPipe).toEqual([false, false, true]);
  });

  it('rejects unknown tokens with the slot number', () => {
    expect(() => parseFlappyLevel('0,banana')).toThrow(/slot 2/);
    expect(() => parseFlappyLevel('3-left')).toThrow(/slot 1/);
    expect(() => parseFlappyLevel('3 down')).toThrow(/slot/);
  });

  it('rejects heights outside 1-8', () => {
    expect(() => parseFlappyLevel('9-down')).toThrow(/slot 1/);
    expect(() => parseFlappyLevel('0-top')).toThrow(/1-8/);
    expect(() => parseFlappyLevel('8-top')).not.toThrow();
    expect(() => parseFlappyLevel('1-down')).not.toThrow();
  });

  it('ships a valid bundled level', () => {
    const level = parseFlappyLevel(LEVEL_1);
    expect(level.topFrac.length).toBeGreaterThan(20);
    const pipeCount = level.hasPipe.filter(Boolean).length;
    expect(pipeCount).toBeGreaterThan(10);
    for (let i = 0; i < level.topFrac.length; i += 1) {
      // One-sided pipes only, max 80% of playable height — a gap always exists.
      expect(Math.min(level.topFrac[i], level.bottomFrac[i])).toBe(0);
      expect(Math.max(level.topFrac[i], level.bottomFrac[i])).toBeLessThanOrEqual(0.8 + 1e-9);
    }
  });
});
