import { BOSS_ROSTER, bossStatsForIndex } from '../bosses';

describe('bossStatsForIndex', () => {
	it('returns the roster stats unscaled for the first cycle', () => {
		BOSS_ROSTER.forEach((spec, i) => {
			const stats = bossStatsForIndex(i);
			expect(stats.rosterIndex).toBe(i);
			expect(stats.maxHp).toBe(spec.maxHp);
			expect(stats.attackIntervalMs).toBe(spec.attackIntervalMs);
		});
	});

	it('loops the roster with more HP each cycle', () => {
		const first = bossStatsForIndex(0);
		const secondCycle = bossStatsForIndex(BOSS_ROSTER.length);
		expect(secondCycle.rosterIndex).toBe(0);
		expect(secondCycle.maxHp).toBeGreaterThan(first.maxHp);
	});

	it('speeds up attacks each cycle but never below the floor', () => {
		const first = bossStatsForIndex(2);
		const later = bossStatsForIndex(2 + BOSS_ROSTER.length);
		expect(later.attackIntervalMs).toBeLessThan(first.attackIntervalMs);

		const far = bossStatsForIndex(2 + BOSS_ROSTER.length * 50);
		expect(far.attackIntervalMs).toBe(2600);
	});

	it('escalates HP across the roster within one cycle', () => {
		const hps = BOSS_ROSTER.map((_, i) => bossStatsForIndex(i).maxHp);
		const sorted = [...hps].sort((a, b) => a - b);
		expect(hps).toEqual(sorted);
	});
});
