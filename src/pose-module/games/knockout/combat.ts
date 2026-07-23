import { KNOCKOUT_COMBAT } from './knockoutConfig';

const B = KNOCKOUT_COMBAT;

/** Combo multiplier for the n-th chained rep (chain starts at 1). */
export function comboMultiplier(chain: number): number {
	'worklet';
	return Math.min(B.MAX_MULTIPLIER, Math.max(1, chain));
}

export function damageForRep(chain: number): number {
	'worklet';
	return B.BASE_DAMAGE * comboMultiplier(chain);
}

/** True when the athlete's position at the strike moment counts as a dodge. */
export function isDodged(position: number): boolean {
	'worklet';
	return position < B.DODGE_THRESHOLD;
}

export function nextPopupSlot(current: number): number {
	'worklet';
	return (current + 1) % B.POPUP_SLOTS;
}

export interface KnockoutGeom {
	bandW: number;
	bandH: number;
	/** Ground line the fighters stand on. */
	floorY: number;
	heroX: number;
	bossX: number;
	/** Hero body radius — every hero part scales off this. */
	heroR: number;
	/** Boss body radius — every boss part scales off this. */
	bossR: number;
	/** How far the hero lunges toward the boss on a punch. */
	lungeDist: number;
	/** How far the boss lunges toward the hero on a strike. */
	strikeDist: number;
}

export function computeKnockoutGeom(bandW: number, bandH: number): KnockoutGeom {
	const floorY = bandH * 0.84;
	const heroR = bandH * 0.1;
	const bossR = bandH * 0.17;
	const heroX = bandW * 0.24;
	const bossX = bandW * 0.72;
	return {
		bandW,
		bandH,
		floorY,
		heroX,
		bossX,
		heroR,
		bossR,
		lungeDist: (bossX - heroX) * 0.42,
		strikeDist: (bossX - heroX) * 0.5,
	};
}
