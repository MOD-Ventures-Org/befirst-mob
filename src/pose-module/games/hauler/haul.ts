import { HAUL_LEVELS, HAULER_PHYSICS, type HaulLevel } from './haulerConfig';

const P = HAULER_PHYSICS;

/** Total cargo pieces across the whole roster. */
export const TOTAL_CARGO = HAUL_LEVELS.reduce((sum, l) => sum + l.count, 0);

/** The level spec for a roster index (clamped). */
export function levelAt(index: number): HaulLevel {
	'worklet';
	const i = index < 0 ? 0 : index >= HAUL_LEVELS.length ? HAUL_LEVELS.length - 1 : index;
	return HAUL_LEVELS[i];
}

/** True when this is the last level in the roster. */
export function isLastLevel(index: number): boolean {
	'worklet';
	return index >= HAUL_LEVELS.length - 1;
}

/** Load fraction after one push-up heave (capped at the top ledge). */
export function climbAfterHeave(climb: number, level: HaulLevel): number {
	'worklet';
	return Math.min(P.DELIVER_AT, climb + level.heaveStep);
}

/** Load fraction after `dtMs` of idle back-slip (never below the base). */
export function climbAfterSlip(climb: number, level: HaulLevel, dtMs: number): number {
	'worklet';
	const next = climb - (P.SLIP_PER_S * level.slipMul * dtMs) / 1000;
	return next < 0 ? 0 : next;
}

/** True once the load has reached the top ledge and should be dropped. */
export function readyToDeliver(climb: number): boolean {
	'worklet';
	return climb >= P.DELIVER_AT;
}

/**
 * A pseudo-random but deterministic scatter offset in [-1, 1] for particle
 * index `i` and seed `s`. No Math.random (banned in worklets and unstable for
 * resumable renders); a hashed sine keeps bursts varied but reproducible.
 */
export function scatter(i: number, s: number): number {
	'worklet';
	const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
	return 2 * (v - Math.floor(v)) - 1;
}
