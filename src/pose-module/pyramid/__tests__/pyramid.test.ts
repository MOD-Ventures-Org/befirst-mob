import {
	buildPyramidRows,
	buildPyramidSequence,
	clampLevel,
	getTotalPyramidReps,
	MAX_LEVEL,
	MIN_LEVEL,
} from '../pyramid';

describe('pyramid helpers', () => {
	describe('buildPyramidSequence', () => {
		it('ascends to the level then descends back to 1 (doc §4)', () => {
			expect(buildPyramidSequence(1)).toEqual([1]);
			expect(buildPyramidSequence(2)).toEqual([1, 2, 1]);
			expect(buildPyramidSequence(3)).toEqual([1, 2, 3, 2, 1]);
			expect(buildPyramidSequence(5)).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1]);
		});

		it('produces 2·level − 1 sets', () => {
			expect(buildPyramidSequence(8)).toHaveLength(15);
		});
	});

	describe('getTotalPyramidReps', () => {
		it('equals level squared (doc §4)', () => {
			expect(getTotalPyramidReps(1)).toBe(1);
			expect(getTotalPyramidReps(2)).toBe(4);
			expect(getTotalPyramidReps(3)).toBe(9);
			expect(getTotalPyramidReps(8)).toBe(64);
		});

		it('matches the sum of the sequence', () => {
			for (let level = 1; level <= MAX_LEVEL; level++) {
				const sum = buildPyramidSequence(level).reduce((acc, reps) => acc + reps, 0);
				expect(sum).toBe(getTotalPyramidReps(level));
			}
		});
	});

	describe('buildPyramidRows', () => {
		it('puts the apex alone on top and pairs the rest', () => {
			const rows = buildPyramidRows(3);
			expect(rows).toEqual([
				{ value: 3, isApex: true },
				{ value: 2, isApex: false },
				{ value: 1, isApex: false },
			]);
		});
	});

	describe('clampLevel', () => {
		it('clamps to the supported 1–8 range', () => {
			expect(clampLevel(0)).toBe(MIN_LEVEL);
			expect(clampLevel(99)).toBe(MAX_LEVEL);
			expect(clampLevel(4.6)).toBe(5);
		});
	});
});
