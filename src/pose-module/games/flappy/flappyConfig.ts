export const FLAPPY_COLORS = {
	skyTop: '#3D7BD9',
	skyMid: '#7EC3F0',
	skyBottom: '#CDEBFA',
	sun: '#FFE082',
	sunHalo: '#FFF3C4',
	cloud: '#FFFFFF',
	hillBack: '#7CC96B',
	hillFront: '#4C9F45',
	pipeEdge: '#2E7D36',
	pipeMid: '#5BCB6B',
	pipeCap: '#256B2C',
	coin: '#F5C542',
	coinInner: '#FFE082',
	coinSparkle: '#FFFFFF',
	birdBody: '#F7941D',
	birdWing: '#E07F0F',
	birdBelly: '#FFE9CF',
	birdBeak: '#F9A03F',
	birdEyeWhite: '#FFFFFF',
	birdEyePupil: '#22252A',
	planeHit: '#FF5B5B',
	flash: '#FF3B30',
	scorePill: 'rgba(23,55,83,0.55)',
	scoreText: '#FFFFFF',
} as const;

export const FLAPPY_GEOMETRY = {
	/** Top/bottom margin of the playable area, fraction of the band height —
	 * generous enough that the bird's body never touches the band edges. */
	PLAY_MARGIN_FRAC: 0.14,
	/** Plane's fixed horizontal position, fraction of the band width. */
	PLANE_X_FRAC: 0.25,
	PIPE_W_FRAC: 0.13,
	PLANE_W_FRAC: 0.12,
	PLANE_H_FRAC: 0.07,
	COIN_R_FRAC: 0.035,
	/** Every level slot (incl. empty "0" slots) is this many pipe-widths wide. */
	SLOT_WIDTH_PIPES: 2,
} as const;

export const FLAPPY_TIMING = {
	/** Seconds between obstacles reaching the plane (spec: ~3 s, tune later). */
	SECONDS_PER_GATE: 3,
	/** Signal loss longer than this pauses the game. */
	SIGNAL_LOST_MS: 1000,
	CONFIDENCE_MIN: 0.5,
	/** Time constant of the display EMA — low enough to feel immediate. */
	EMA_TAU_MS: 45,
	HIT_FLASH_DECAY_MS: 300,
	/** Cap on frame delta so a hitched frame cannot teleport the world. */
	MAX_FRAME_DT_MS: 64,
	/** Countdown beats after Start: "3" at 0 ms, "2", "1", then GO. */
	COUNTDOWN_2_AT_MS: 2000,
	COUNTDOWN_1_AT_MS: 4000,
	COUNTDOWN_GO_AT_MS: 5000,
} as const;
