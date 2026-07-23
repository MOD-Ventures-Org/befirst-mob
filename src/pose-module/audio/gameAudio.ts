import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { COUNT_VOICE_SOURCES } from './countVoiceSources';

// Short procedurally-generated game SFX (see src/assets/sounds/sfx).
const SFX_SOURCES = {
	coin: require('@/src/assets/sounds/sfx/coin.wav'),
	hit: require('@/src/assets/sounds/sfx/hit.wav'),
	point: require('@/src/assets/sounds/sfx/point.wav'),
	go: require('@/src/assets/sounds/sfx/go.wav'),
	fanfare: require('@/src/assets/sounds/sfx/fanfare.wav'),
	brick: require('@/src/assets/sounds/sfx/brick.wav'),
	column: require('@/src/assets/sounds/sfx/column.wav'),
	punch: require('@/src/assets/sounds/sfx/punch.wav'),
	warning: require('@/src/assets/sounds/sfx/warning.wav'),
	dodge: require('@/src/assets/sounds/sfx/dodge.wav'),
	ko: require('@/src/assets/sounds/sfx/ko.wav'),
	pistol: require('@/src/assets/sounds/sfx/pistol.wav'),
	overtake: require('@/src/assets/sounds/sfx/overtake.wav'),
	grunt: require('@/src/assets/sounds/sfx/grunt.wav'),
	thud: require('@/src/assets/sounds/sfx/thud.wav'),
	scrape: require('@/src/assets/sounds/sfx/scrape.wav'),
	levelup: require('@/src/assets/sounds/sfx/levelup.wav'),
} as const;

export type GameSfx = keyof typeof SFX_SOURCES;

let sfxPlayers: Partial<Record<GameSfx, AudioPlayer>> = {};
let countPlayers = new Map<number, AudioPlayer>();
let audioModeSet = false;

function ensureAudioMode(): void {
	if (audioModeSet) return;
	audioModeSet = true;
	// Workout sounds must be audible with the iOS mute switch on, and mix with
	// the user's own music instead of stopping it.
	void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
}

/** Fire-and-forget game sound effect; players are pooled per effect. */
export function playGameSfx(name: GameSfx): void {
	try {
		ensureAudioMode();
		let player = sfxPlayers[name];
		if (!player) {
			player = createAudioPlayer(SFX_SOURCES[name]);
			player.volume = 1;
			sfxPlayers[name] = player;
		}
		player.seekTo(0);
		player.play();
	} catch {
		// Audio must never break a workout session.
	}
}

/**
 * Speaks the rep count ("1", "2", …) with the bundled neural voice. Players
 * are cached per number so repeated counts (and the 3-2-1 countdown) play
 * with zero load latency.
 */
export function playCountVoice(count: number): void {
	try {
		ensureAudioMode();
		const source = COUNT_VOICE_SOURCES[count - 1];
		if (!source) return;
		let player = countPlayers.get(count);
		if (!player) {
			player = createAudioPlayer(source);
			player.volume = 1;
			countPlayers.set(count, player);
		}
		player.seekTo(0);
		player.play();
	} catch {
		// Audio must never break a workout session.
	}
}

/** Releases all pooled players — call on screen unmount. */
export function releaseGameAudio(): void {
	for (const player of Object.values(sfxPlayers)) {
		try {
			player?.remove();
		} catch {}
	}
	sfxPlayers = {};
	for (const player of countPlayers.values()) {
		try {
			player.remove();
		} catch {}
	}
	countPlayers = new Map();
}
