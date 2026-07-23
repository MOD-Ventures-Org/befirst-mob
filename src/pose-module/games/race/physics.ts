import { RACE_PHYSICS } from './raceConfig';

const P = RACE_PHYSICS;

/** Rep energy after `dtMs` of exponential decay. */
export function energyAfter(energy: number, dtMs: number): number {
	'worklet';
	return energy * Math.exp(-dtMs / P.ENERGY_TAU_MS);
}

/** Energy right after a counted rep (capped). */
export function energyAfterRep(energy: number): number {
	'worklet';
	return Math.min(P.ENERGY_CAP, energy + P.REP_ENERGY);
}

/**
 * The athlete's running speed (m/s) for the current energy. Saturating curve:
 * a slow steady cadence (~1 rep / 4 s) sustains ~4 m/s — above every bot's
 * cruise speed — and an all-out sprint approaches ~7.3 m/s.
 */
export function speedForEnergy(energy: number): number {
	'worklet';
	return (P.MAX_SPEED_MS * energy) / (energy + P.HALF_ENERGY);
}

/**
 * Bot speed with rubber-banding: far behind the player they push harder
 * (the rest you earned shrinks believably), far ahead they ease off (the
 * race stays winnable). `gapM` = playerDist − botDist.
 */
export function botSpeed(baseMs: number, gapM: number): number {
	'worklet';
	if (gapM > P.RUBBER_FAR_M) return baseMs * P.RUBBER_FAR_BOOST;
	if (gapM < -P.RUBBER_AHEAD_M) return baseMs * P.RUBBER_AHEAD_EASE;
	return baseMs;
}

/** Player's live place, 1-based: 1 + bots strictly ahead. */
export function rankOf(playerDist: number, botDists: readonly number[]): number {
	'worklet';
	let ahead = 0;
	for (let i = 0; i < botDists.length; i += 1) {
		if (botDists[i] > playerDist) ahead += 1;
	}
	return 1 + ahead;
}

/**
 * Sprite-strip frame for a runner: frame 0 is the standing pose, frames
 * 1..runFrames cycle with distance traveled so the legs stay in sync with
 * the actual speed.
 */
export function spriteFrame(distanceM: number, speedMs: number, runFrames: number): number {
	'worklet';
	if (speedMs < P.IDLE_SPEED_MS) return 0;
	return 1 + (Math.floor(distanceM / P.STRIDE_M) % runFrames);
}
