import {
	comboMultiplier,
	computeKnockoutGeom,
	damageForRep,
	isDodged,
	nextPopupSlot,
} from '../combat';
import { KNOCKOUT_COMBAT } from '../knockoutConfig';

const B = KNOCKOUT_COMBAT;

describe('comboMultiplier', () => {
	it('starts at x1 and grows with the chain', () => {
		expect(comboMultiplier(0)).toBe(1);
		expect(comboMultiplier(1)).toBe(1);
		expect(comboMultiplier(2)).toBe(2);
		expect(comboMultiplier(3)).toBe(3);
	});

	it('caps at the max multiplier', () => {
		expect(comboMultiplier(B.MAX_MULTIPLIER)).toBe(B.MAX_MULTIPLIER);
		expect(comboMultiplier(99)).toBe(B.MAX_MULTIPLIER);
	});
});

describe('damageForRep', () => {
	it('scales the base damage by the combo multiplier', () => {
		expect(damageForRep(1)).toBe(B.BASE_DAMAGE);
		expect(damageForRep(2)).toBe(B.BASE_DAMAGE * 2);
		expect(damageForRep(99)).toBe(B.BASE_DAMAGE * B.MAX_MULTIPLIER);
	});
});

describe('isDodged', () => {
	it('dodges only when the athlete holds the bottom', () => {
		expect(isDodged(0)).toBe(true);
		expect(isDodged(B.DODGE_THRESHOLD - 0.01)).toBe(true);
		expect(isDodged(B.DODGE_THRESHOLD)).toBe(false);
		expect(isDodged(1)).toBe(false);
	});
});

describe('nextPopupSlot', () => {
	it('cycles round-robin through the pool', () => {
		expect(nextPopupSlot(-1)).toBe(0);
		expect(nextPopupSlot(0)).toBe(1);
		expect(nextPopupSlot(1)).toBe(2);
		expect(nextPopupSlot(2)).toBe(0);
	});
});

describe('computeKnockoutGeom', () => {
	it('places the hero left of the boss on the floor line', () => {
		const geom = computeKnockoutGeom(400, 300);
		expect(geom.bandW).toBe(400);
		expect(geom.bandH).toBe(300);
		expect(geom.heroX).toBeLessThan(geom.bossX);
		expect(geom.floorY).toBeLessThan(geom.bandH);
		expect(geom.floorY).toBeGreaterThan(geom.bandH / 2);
	});

	it('keeps the lunge and strike within the fighters gap', () => {
		const geom = computeKnockoutGeom(400, 300);
		const gap = geom.bossX - geom.heroX;
		expect(geom.lungeDist).toBeLessThan(gap);
		expect(geom.strikeDist).toBeLessThan(gap);
		expect(geom.lungeDist).toBeGreaterThan(0);
		expect(geom.strikeDist).toBeGreaterThan(0);
	});
});
