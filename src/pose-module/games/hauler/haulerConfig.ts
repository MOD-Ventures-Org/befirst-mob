export const HAULER_COLORS = {
	hudPill: 'rgba(13,24,40,0.55)',
	hudText: '#FFFFFF',
	hudAccent: '#F7C948',
	gaugeBack: 'rgba(0,0,0,0.35)',
	gaugeFill: '#F7941D',
	rampTop: '#4A4A55',
	rampFace: '#33333C',
	rampEdge: '#5C5C68',
	platform: '#3E3E48',
	torchGlow: '#FFB347',
	bannerText: '#FFFFFF',
	dust: '#8A8172',
} as const;

export const HAULER_TIMING = {
	/** Signal loss longer than this pauses the haul (all timers freeze). */
	SIGNAL_LOST_MS: 1000,
	CONFIDENCE_MIN: 0.5,
	/** Cap on frame delta so a hitched frame cannot teleport the world. */
	MAX_FRAME_DT_MS: 64,
	/** Level-up / calibration banner beat length. */
	BANNER_MS: 1500,
	/** Heave pulse decay: how long a single push-up's lunge reads on the body. */
	HEAVE_DECAY_MS: 420,
	/** Screen-shake decay after a heave / delivery. */
	SHAKE_MS: 520,
	/** Auto climb-down trip after a delivery, before the next cargo. */
	RETURN_MS: 1300,
} as const;

export const HAULER_PHYSICS = {
	/** Idle back-slip of the load, in climb-fraction per second. Keeps tension. */
	SLIP_PER_S: 0.055,
	/** Delivery fires once the load reaches the top ledge. */
	DELIVER_AT: 1,
} as const;

export type CargoType = 'rocks' | 'crate' | 'flask' | 'chest' | 'coin';
export type MonsterType = 'ogre' | 'demon';

export interface HaulLevel {
	/** i18n suffix under settings:aiTrainer.games.hauler.levels.* */
	nameKey: 'quarry' | 'crates' | 'cellar' | 'vault' | 'hoard';
	cargo: CargoType;
	/** Which pixel-art brute hauls this level. */
	monster: MonsterType;
	/** Cargo pieces to deliver before the level clears. */
	count: number;
	/** Climb-fraction added by a single push-up. Heavier cargo = smaller step. */
	heaveStep: number;
	/** Idle back-slip multiplier for this cargo (heavier slips faster). */
	slipMul: number;
	/** Mass credited per delivered piece, kg — drives the "lifted" counter. */
	weightKg: number;
	/** Cave gradient tint for the level's biome. */
	skyTop: string;
	skyBottom: string;
}

/**
 * The haul roster. Each level is a new cargo the ogre carries bottom → top of a
 * dungeon ramp: rocks from the quarry, then crates, cellar potions, a vault
 * chest, and finally a demon hauling gold. Heavier cargo needs more push-ups
 * per trip and slips back faster if the athlete rests. Pure data so the engine,
 * scene, and jest read one source; art is real CC0 pixel-art (0x72 Dungeon
 * Tileset II) rendered as sprites.
 */
export const HAUL_LEVELS: readonly HaulLevel[] = [
	{
		nameKey: 'quarry',
		cargo: 'rocks',
		monster: 'ogre',
		count: 4,
		heaveStep: 0.2,
		slipMul: 1,
		weightKg: 90,
		skyTop: '#20242E',
		skyBottom: '#3C4657',
	},
	{
		nameKey: 'crates',
		cargo: 'crate',
		monster: 'ogre',
		count: 5,
		heaveStep: 0.18,
		slipMul: 1.1,
		weightKg: 120,
		skyTop: '#241E16',
		skyBottom: '#463A2A',
	},
	{
		nameKey: 'cellar',
		cargo: 'flask',
		monster: 'ogre',
		count: 5,
		heaveStep: 0.16,
		slipMul: 1.2,
		weightKg: 150,
		skyTop: '#1E1A2C',
		skyBottom: '#3A3054',
	},
	{
		nameKey: 'vault',
		cargo: 'chest',
		monster: 'demon',
		count: 6,
		heaveStep: 0.14,
		slipMul: 1.35,
		weightKg: 210,
		skyTop: '#26200E',
		skyBottom: '#5A4A18',
	},
	{
		nameKey: 'hoard',
		cargo: 'coin',
		monster: 'demon',
		count: 6,
		heaveStep: 0.125,
		slipMul: 1.5,
		weightKg: 280,
		skyTop: '#101E1C',
		skyBottom: '#1E3E3A',
	},
] as const;
