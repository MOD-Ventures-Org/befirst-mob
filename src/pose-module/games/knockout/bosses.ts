/**
 * The boss tower roster. Pure data + lookup so the engine and the band read
 * the same source and jest can cover the scaling math. Silhouettes are
 * parametric flags the band turns into flat Skia shapes — no assets.
 */
export interface BossSpec {
	/** i18n suffix under settings:aiTrainer.games.knockout.bosses.* */
	nameKey: 'slime' | 'golem' | 'yeti' | 'imp' | 'dragon';
	body: string;
	bodyDark: string;
	belly: string;
	sky: string;
	floor: string;
	maxHp: number;
	/** Idle time between attacks. */
	attackIntervalMs: number;
	hasCrown: boolean;
	hasHorns: boolean;
	hasWings: boolean;
	/** 1 = round blob, 0 = blocky. */
	roundness: number;
}

export const BOSS_ROSTER: readonly BossSpec[] = [
	{
		nameKey: 'slime',
		body: '#5BCB6B',
		bodyDark: '#2E7D36',
		belly: '#A7E8AF',
		sky: '#7EC3F0',
		floor: '#4C9F45',
		maxHp: 100,
		attackIntervalMs: 5200,
		hasCrown: true,
		hasHorns: false,
		hasWings: false,
		roundness: 1,
	},
	{
		nameKey: 'golem',
		body: '#8D8D9C',
		bodyDark: '#5A5A68',
		belly: '#B9B9C6',
		sky: '#C9B79C',
		floor: '#8A6F4D',
		maxHp: 140,
		attackIntervalMs: 4800,
		hasCrown: false,
		hasHorns: false,
		hasWings: false,
		roundness: 0,
	},
	{
		nameKey: 'yeti',
		body: '#9FD9F0',
		bodyDark: '#5FA8CC',
		belly: '#E4F6FD',
		sky: '#DCEFF7',
		floor: '#BBDDE9',
		maxHp: 180,
		attackIntervalMs: 4400,
		hasCrown: false,
		hasHorns: true,
		hasWings: false,
		roundness: 0.6,
	},
	{
		nameKey: 'imp',
		body: '#F0563C',
		bodyDark: '#B93321',
		belly: '#FFAD7E',
		sky: '#F5A25B',
		floor: '#8C3B22',
		maxHp: 220,
		attackIntervalMs: 4000,
		hasCrown: false,
		hasHorns: true,
		hasWings: false,
		roundness: 0.85,
	},
	{
		nameKey: 'dragon',
		body: '#7C4DD4',
		bodyDark: '#4B2A8C',
		belly: '#C4A9F2',
		sky: '#3A2E5C',
		floor: '#2A2144',
		maxHp: 260,
		attackIntervalMs: 3600,
		hasCrown: false,
		hasHorns: true,
		hasWings: true,
		roundness: 0.75,
	},
] as const;

export interface BossStats {
	rosterIndex: number;
	maxHp: number;
	attackIntervalMs: number;
}

const HP_PER_CYCLE = 120;
const INTERVAL_CUT_PER_CYCLE_MS = 500;
const MIN_ATTACK_INTERVAL_MS = 2600;

/**
 * Stats for the i-th boss of the endless tower: the 5-boss roster loops with
 * more HP and faster attacks each cycle.
 */
export function bossStatsForIndex(index: number): BossStats {
	'worklet';
	const rosterIndex = index % BOSS_ROSTER.length;
	const cycle = Math.floor(index / BOSS_ROSTER.length);
	const spec = BOSS_ROSTER[rosterIndex];
	return {
		rosterIndex,
		maxHp: spec.maxHp + cycle * HP_PER_CYCLE,
		attackIntervalMs: Math.max(
			MIN_ATTACK_INTERVAL_MS,
			spec.attackIntervalMs - cycle * INTERVAL_CUT_PER_CYCLE_MS,
		),
	};
}
