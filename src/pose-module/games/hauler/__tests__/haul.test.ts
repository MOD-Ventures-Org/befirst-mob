import { climbAfterHeave, climbAfterSlip, isLastLevel, levelAt, readyToDeliver, scatter, TOTAL_CARGO } from '../haul';
import { HAUL_LEVELS } from '../haulerConfig';

describe('hauler physics', () => {
	const first = HAUL_LEVELS[0];

	describe('levelAt', () => {
		it('returns the matching level', () => {
			expect(levelAt(0)).toBe(HAUL_LEVELS[0]);
			expect(levelAt(2)).toBe(HAUL_LEVELS[2]);
		});

		it('clamps out-of-range indexes', () => {
			expect(levelAt(-5)).toBe(HAUL_LEVELS[0]);
			expect(levelAt(999)).toBe(HAUL_LEVELS[HAUL_LEVELS.length - 1]);
		});
	});

	describe('isLastLevel', () => {
		it('is true only on the final roster index', () => {
			expect(isLastLevel(0)).toBe(false);
			expect(isLastLevel(HAUL_LEVELS.length - 1)).toBe(true);
			expect(isLastLevel(HAUL_LEVELS.length + 3)).toBe(true);
		});
	});

	describe('climbAfterHeave', () => {
		it('advances the load by the level heave step', () => {
			expect(climbAfterHeave(0, first)).toBeCloseTo(first.heaveStep, 5);
		});

		it('never overshoots the top ledge', () => {
			expect(climbAfterHeave(0.95, first)).toBe(1);
			expect(climbAfterHeave(1, first)).toBe(1);
		});

		it('needs more heaves for heavier cargo', () => {
			const lightHeaves = Math.ceil(1 / HAUL_LEVELS[0].heaveStep);
			const heavyHeaves = Math.ceil(1 / HAUL_LEVELS[HAUL_LEVELS.length - 1].heaveStep);
			expect(heavyHeaves).toBeGreaterThan(lightHeaves);
		});
	});

	describe('climbAfterSlip', () => {
		it('slips the load back over time', () => {
			const slipped = climbAfterSlip(0.5, first, 1000);
			expect(slipped).toBeLessThan(0.5);
		});

		it('never slips below the base', () => {
			expect(climbAfterSlip(0.01, first, 100000)).toBe(0);
		});

		it('slips heavier cargo faster', () => {
			const heavy = HAUL_LEVELS[HAUL_LEVELS.length - 1];
			const lightSlip = 0.5 - climbAfterSlip(0.5, first, 1000);
			const heavySlip = 0.5 - climbAfterSlip(0.5, heavy, 1000);
			expect(heavySlip).toBeGreaterThan(lightSlip);
		});

		it('a single heave outpaces a frame of slip', () => {
			const afterHeave = climbAfterHeave(0.3, first);
			const afterSlip = climbAfterSlip(afterHeave, first, 32);
			expect(afterSlip).toBeGreaterThan(0.3);
		});
	});

	describe('readyToDeliver', () => {
		it('fires only once the load reaches the ledge', () => {
			expect(readyToDeliver(0.99)).toBe(false);
			expect(readyToDeliver(1)).toBe(true);
		});

		// A heave that reaches the top must be delivered before the next slip is
		// applied, or the load is nibbled below 1 and delivery never fires.
		it('a topped-out load is deliverable, but a slip would drop it below', () => {
			const topped = climbAfterHeave(0.9, first);
			expect(topped).toBe(1);
			expect(readyToDeliver(topped)).toBe(true);
			expect(readyToDeliver(climbAfterSlip(topped, first, 16))).toBe(false);
		});
	});

	describe('scatter', () => {
		it('stays within [-1, 1]', () => {
			for (let i = 0; i < 20; i += 1) {
				const v = scatter(i, 7);
				expect(v).toBeGreaterThanOrEqual(-1);
				expect(v).toBeLessThanOrEqual(1);
			}
		});

		it('is deterministic for the same inputs', () => {
			expect(scatter(3, 4)).toBe(scatter(3, 4));
		});

		it('varies across indexes', () => {
			expect(scatter(1, 2)).not.toBe(scatter(2, 2));
		});
	});

	describe('TOTAL_CARGO', () => {
		it('sums every level count', () => {
			const expected = HAUL_LEVELS.reduce((s, l) => s + l.count, 0);
			expect(TOTAL_CARGO).toBe(expected);
		});
	});
});
