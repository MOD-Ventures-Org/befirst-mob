import {
	botSpeed,
	energyAfter,
	energyAfterRep,
	rankOf,
	speedForEnergy,
	spriteFrame,
} from '../physics';
import { RACE_PHYSICS } from '../raceConfig';

const P = RACE_PHYSICS;

describe('energy model', () => {
	it('decays exponentially and never goes negative', () => {
		const e = energyAfter(2, P.ENERGY_TAU_MS);
		expect(e).toBeCloseTo(2 / Math.E, 5);
		expect(energyAfter(0, 10000)).toBe(0);
	});

	it('reps add energy up to the cap', () => {
		expect(energyAfterRep(0)).toBe(P.REP_ENERGY);
		expect(energyAfterRep(P.ENERGY_CAP)).toBe(P.ENERGY_CAP);
	});

	it('slow steady cadence sustains a speed above every bot', () => {
		// Equilibrium energy at 1 rep / 4 s: e ≈ REP_ENERGY · τ(s) / 4 s.
		const slowCadenceEnergy = (P.REP_ENERGY * P.ENERGY_TAU_MS) / 4000;
		const sustained = speedForEnergy(slowCadenceEnergy);
		for (const base of P.BOT_BASE_MS) {
			expect(sustained).toBeGreaterThan(base);
		}
	});

	it('resting collapses speed below every bot', () => {
		let e = 2;
		for (let i = 0; i < 12; i += 1) e = energyAfter(e, 1000);
		const restedSpeed = speedForEnergy(e);
		for (const base of P.BOT_BASE_MS) {
			expect(restedSpeed).toBeLessThan(base);
		}
	});

	it('speed saturates below the maximum', () => {
		expect(speedForEnergy(P.ENERGY_CAP)).toBeLessThan(P.MAX_SPEED_MS);
		expect(speedForEnergy(4)).toBeGreaterThan(speedForEnergy(1));
	});
});

describe('botSpeed rubber band', () => {
	it('pushes when far behind, eases when far ahead, cruises otherwise', () => {
		expect(botSpeed(3, P.RUBBER_FAR_M + 1)).toBeCloseTo(3 * P.RUBBER_FAR_BOOST, 5);
		expect(botSpeed(3, -(P.RUBBER_AHEAD_M + 1))).toBeCloseTo(3 * P.RUBBER_AHEAD_EASE, 5);
		expect(botSpeed(3, 0)).toBe(3);
	});
});

describe('rankOf', () => {
	it('counts bots strictly ahead', () => {
		expect(rankOf(100, [50, 60, 70])).toBe(1);
		expect(rankOf(65, [50, 60, 70])).toBe(2);
		expect(rankOf(55, [50, 60, 70])).toBe(3);
		expect(rankOf(10, [50, 60, 70])).toBe(4);
		expect(rankOf(50, [50, 60, 70])).toBe(3);
	});
});

describe('spriteFrame', () => {
	it('stands still below the idle threshold', () => {
		expect(spriteFrame(42, 0, 3)).toBe(0);
		expect(spriteFrame(42, P.IDLE_SPEED_MS - 0.01, 3)).toBe(0);
	});

	it('cycles run frames with distance', () => {
		const frames = [0, 1, 2, 3].map(i => spriteFrame(i * P.STRIDE_M, 5, 3));
		expect(frames).toEqual([1, 2, 3, 1]);
	});
});
