// Pure helpers for the AI Push-Up Trainer "Pyramid" mode (POC).
//
// A pyramid ascends from 1 rep up to the selected level, then descends back to
// 1. Each number in the sequence is one set, with a fixed rest between sets.
// See `no-git-docs/doc.pdf` §4 — total reps always equals level squared.

// BeFirst orange — the primary fill / active color for the pyramid overlay
// (doc §8 "Visual & Design Notes").
export const BRAND_ORANGE = '#F7941D';

// Timing (ms) — doc §6.4 / §6.5 / §7. We state the product rule but stay
// intentionally lenient; the grace windows give the user room to keep going.
export const PYRAMID_TIMING = {
	// A completed set's fully-filled ring holds on screen before the rest starts,
	// then the countdown shows 3 for 0.5 s and 2 / 1 for 1 s each — the set-end
	// beat still totals 3 s (0.5 + 2.5).
	SET_DONE_MS: 500,
	REST_MS: 2500,
	GO_GRACE_MS: 3000, // GO window after rest — no push-up triggers the start prompt
	START_PROMPT_MS: 1000, // "Push Up or Quit" second chance after GO (1·0)
	REP_PAUSE_MS: 3000, // ~3 s pause mid-set triggers the rep prompt
	REP_PROMPT_MS: 2000, // "Push Up or Quit" countdown mid-set (2·1·0)
	// Final-set celebration (🎉 ring + "Level N Unlocked!") held before the
	// success screen; the recording keeps rolling so the moment ends up on video.
	CELEBRATE_MS: 5000,
} as const;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 8;
export const DEFAULT_LEVEL = 8;

/**
 * Build the set sequence for a level: 1 → 2 → … → level → … → 2 → 1.
 * Each entry is one set's target reps. Example (level 3): [1, 2, 3, 2, 1].
 */
export function buildPyramidSequence(level: number): number[] {
	const up = Array.from({ length: level }, (_, i) => i + 1);
	const down = Array.from({ length: level - 1 }, (_, i) => level - 1 - i);
	return [...up, ...down];
}

/** Total reps across the whole pyramid (equals level²). */
export function getTotalPyramidReps(level: number): number {
	return level * level;
}

export interface PyramidRow {
	// Row number value (apex = level, descending to 1 at the base).
	value: number;
	// Whether this row has a single apex number or a left/right pair.
	isApex: boolean;
}

/**
 * Rows for the decorative backdrop pyramid (doc §6.1 "top level always shown in
 * 1 place … other numbers go right and left making the pyramid view"). The apex
 * (= level) sits alone at the top; every row below shows a left/right pair.
 */
export function buildPyramidRows(level: number): PyramidRow[] {
	const rows: PyramidRow[] = [{ value: level, isApex: true }];
	for (let value = level - 1; value >= 1; value--) {
		rows.push({ value, isApex: false });
	}
	return rows;
}

export function clampLevel(level: number): number {
	return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
}
