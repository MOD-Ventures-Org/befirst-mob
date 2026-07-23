export const KNOCKOUT_COLORS = {
	hero: '#F7941D',
	heroDark: '#E07F0F',
	heroBelly: '#FFE9CF',
	glove: '#D7263D',
	gloveShine: '#F25C6B',
	eyeWhite: '#FFFFFF',
	eyePupil: '#22252A',
	impactStar: '#FFE082',
	heart: '#FF3B5C',
	heartLost: 'rgba(255,255,255,0.28)',
	hpBack: 'rgba(0,0,0,0.35)',
	hpFill: '#5BE06B',
	hpLow: '#FF5B5B',
	comboText: '#FFD34D',
	comboMeter: '#FFD34D',
	comboMeterBack: 'rgba(0,0,0,0.3)',
	popup: '#FFFFFF',
	popupCrit: '#FFD34D',
	warning: '#FFD34D',
	dodged: '#5BE06B',
	flash: '#FF3B30',
	scorePill: 'rgba(0,0,0,0.4)',
	scoreText: '#FFFFFF',
	bannerText: '#FFFFFF',
} as const;

export const KNOCKOUT_TIMING = {
	/** Signal loss longer than this pauses the fight (timers freeze). */
	SIGNAL_LOST_MS: 1000,
	CONFIDENCE_MIN: 0.5,
	/** Cap on frame delta so a hitched frame cannot skip boss phases. */
	MAX_FRAME_DT_MS: 64,
	/** Time constant of the display EMA on the position signal. */
	EMA_TAU_MS: 45,
	/** A rep landed within this window of the previous one extends the combo. */
	COMBO_WINDOW_MS: 3500,
	/** Boss wind-up: the athlete has this long to get down and hold. */
	TELEGRAPH_MS: 1800,
	/** Boss strike lunge duration. */
	STRIKE_MS: 350,
	/** Boss death (flash + fall) before the next one enters. */
	DYING_MS: 900,
	/** Next boss walk-in duration. */
	ENTER_MS: 1000,
	/** Hero punch lunge timeline. */
	PUNCH_MS: 300,
	/** Impact star flash on the boss. */
	IMPACT_MS: 260,
	SHAKE_MS: 450,
	HIT_FLASH_MS: 320,
	/** "DODGED!" text beat. */
	DODGE_MS: 900,
	/** "FIGHT!" banner after the calibration rep. */
	FIGHT_BANNER_MS: 1100,
	/** Damage popup float-up lifetime. */
	POPUP_MS: 800,
} as const;

export const KNOCKOUT_COMBAT = {
	BASE_DAMAGE: 10,
	MAX_MULTIPLIER: 4,
	/** Athlete must be below this position at the strike moment to dodge. */
	DODGE_THRESHOLD: 0.45,
	DODGE_BONUS: 15,
	BOSS_DEFEAT_BONUS: 50,
	MAX_HEARTS: 3,
	POPUP_SLOTS: 3,
} as const;
