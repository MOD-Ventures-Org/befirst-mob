export const RACE_COLORS = {
	grass: '#79C05B',
	hudPill: 'rgba(13,24,40,0.55)',
	hudText: '#FFFFFF',
	placeGold: '#FFD34D',
	placeGrey: '#DCE1E8',
	progressBack: 'rgba(0,0,0,0.35)',
	progressFill: '#F7941D',
	playerDot: '#F7941D',
	botDot: '#DCE1E8',
	gapAhead: '#5BE06B',
	gapBehind: '#FF5B5B',
	bannerText: '#FFFFFF',
} as const;

export const RACE_TIMING = {
	/** Signal loss longer than this pauses the race (all timers freeze). */
	SIGNAL_LOST_MS: 1000,
	CONFIDENCE_MIN: 0.5,
	/** Cap on frame delta so a hitched frame cannot teleport the field. */
	MAX_FRAME_DT_MS: 64,
	/** "GO!" banner after the calibration rep. */
	GO_BANNER_MS: 1100,
	/** Min time between "bot on your heels" warnings. */
	WARN_COOLDOWN_MS: 4000,
} as const;

export const RACE_PHYSICS = {
	RACE_LENGTH_M: 250,
	/** Exponential decay time constant of rep energy. */
	ENERGY_TAU_MS: 4000,
	/** Energy added per counted rep. */
	REP_ENERGY: 1,
	ENERGY_CAP: 4,
	/** speed = MAX * e / (e + HALF): slow cadence ~4 m/s, sprint ~7.3 m/s. */
	MAX_SPEED_MS: 10,
	HALF_ENERGY: 1.5,
	/** Below this speed the runner stands (idle sprite frame). */
	IDLE_SPEED_MS: 0.3,
	/** Bot cruise speeds — all below the athlete's slow-but-steady pace. */
	BOT_BASE_MS: [2.6, 2.9, 3.1] as const,
	/** Rubber band: far-behind bots push, far-ahead bots ease off. */
	RUBBER_FAR_M: 30,
	RUBBER_FAR_BOOST: 1.25,
	RUBBER_AHEAD_M: 15,
	RUBBER_AHEAD_EASE: 0.85,
	/** A bot within this distance behind the player triggers the warning. */
	WARN_GAP_M: 5,
	/** Meters of travel per run-cycle sprite frame. */
	STRIDE_M: 0.8,
} as const;

export const RACE_GEOMETRY = {
	/** Player's fixed horizontal position, fraction of screen width. */
	PLAYER_X_FRAC: 0.3,
	PX_PER_M: 40,
	/** Top of the track band, fraction of screen height. */
	TRACK_TOP_FRAC: 0.62,
	/** Runner sprite height, fraction of screen height. */
	RUNNER_H_FRAC: 0.17,
	/** Parallax factors: forest world drifts, trackside crowd almost keeps up. */
	PARALLAX_BG: 0.25,
	PARALLAX_CROWD: 0.85,
} as const;
