import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
	Canvas,
	Group,
	Circle,
	Image as SkiaImage,
	Oval,
	rect,
	RoundedRect,
	Text as SkiaText,
	useFont,
	useImage,
	type SkImage,
} from '@shopify/react-native-skia';
import Animated, {
	type SharedValue,
	useAnimatedStyle,
	useDerivedValue,
	withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import interSemiBold from '@/src/assets/fonts/Inter-SemiBold.ttf';

import { spriteFrame } from './physics';
import { RACE_COLORS, RACE_GEOMETRY, RACE_PHYSICS } from './raceConfig';
import type { RaceEngine } from './useRaceEngine';

const C = RACE_COLORS;
const G = RACE_GEOMETRY;
const P = RACE_PHYSICS;
const OFFSCREEN = -9999;
const FONT_HUD = 16;
const FONT_BADGE = 22;
const FONT_BANNER = 56;
const STRIP_FRAMES = 4;
const RUN_FRAMES = 3;
/** Source frame size inside the runner sprite strips. */
const SRC_W = 96;
const SRC_H = 128;

interface RaceSceneProps {
	engine: RaceEngine;
	/** Safe-area top inset so the HUD clears the screen header. */
	topInset: number;
}

interface LayerProps {
	image: SkImage | null;
	worldPx: SharedValue<number>;
	factor: number;
	y: number;
	tileW: number;
	tileH: number;
	copy: number;
}

/** One wrapped copy of a parallax background tile. */
const ParallaxTile = ({ image, worldPx, factor, y, tileW, tileH, copy }: LayerProps) => {
	const x = useDerivedValue(() => {
		const off = -((worldPx.value * factor) % tileW);
		return off + copy * tileW;
	});
	if (!image) return null;
	return <SkiaImage image={image} x={x} y={y} width={tileW} height={tileH} fit="fill" />;
};

interface RunnerProps {
	image: SkImage | null;
	/** Distance and speed of this runner, for position and leg cadence. */
	dist: SharedValue<number>;
	speed: SharedValue<number>;
	playerDist: SharedValue<number>;
	isPlayer: boolean;
	playerX: number;
	laneY: number;
	scale: number;
	drawH: number;
	screenW: number;
}

/**
 * One sprite-strip runner with a ground shadow: the strip slides inside a
 * clip so the legs stay in sync with the actual speed.
 */
const Runner = ({ image, dist, speed, playerDist, isPlayer, playerX, laneY, scale, drawH, screenW }: RunnerProps) => {
	const drawW = drawH * (SRC_W / SRC_H);

	const transform = useDerivedValue(() => {
		const relPx = isPlayer ? 0 : (dist.value - playerDist.value) * G.PX_PER_M;
		let x = playerX + relPx - (drawW * scale) / 2;
		if (x < -drawW * 3 || x > screenW + drawW * 2) x = OFFSCREEN;
		return [{ translateX: x }, { translateY: laneY - drawH * scale }, { scale }];
	});
	const stripX = useDerivedValue(() => {
		const frame = spriteFrame(dist.value, speed.value, RUN_FRAMES);
		return -frame * drawW;
	});

	if (!image) return null;
	return (
		<Group transform={transform}>
			<Oval x={drawW * 0.1} y={drawH - 7} width={drawW * 0.8} height={12} color="#000000" opacity={0.22} />
			<Group clip={rect(0, 0, drawW, drawH)}>
				<SkiaImage image={image} x={stripX} y={0} width={drawW * STRIP_FRAMES} height={drawH} fit="fill" />
			</Group>
		</Group>
	);
};

interface StreakProps {
	engine: RaceEngine;
	playerX: number;
	laneY: number;
	drawH: number;
	offsetY: number;
	length: number;
}

/** A motion streak behind the player, visible only while sprinting. */
const SpeedStreak = ({ engine, playerX, laneY, drawH, offsetY, length }: StreakProps) => {
	const opacity = useDerivedValue(() =>
		Math.min(0.5, Math.max(0, (engine.playerSpeed.value - 5) / 3) * 0.7),
	);
	const x = useDerivedValue(() => {
		const jitter = (engine.playerDist.value * G.PX_PER_M) % 26;
		return playerX - drawH * 0.7 - length - jitter;
	});
	return (
		<Group opacity={opacity}>
			<RoundedRect x={x} y={laneY - drawH + offsetY} width={length} height={4} r={2} color="#FFFFFF" />
		</Group>
	);
};

/**
 * The full-screen Push Race scene: a cohesive Kenney forest world, trackside
 * crowd, lane-lined track, sprite runners with shadows and sprint streaks.
 * Every animated prop derives from the engine's shared values — zero React
 * re-renders while racing.
 */
export const RaceScene = React.memo(({ engine, topInset }: RaceSceneProps) => {
	const { t } = useTranslation(['settings']);
	const fontHud = useFont(interSemiBold, FONT_HUD);
	const fontBadge = useFont(interSemiBold, FONT_BADGE);
	const fontBanner = useFont(interSemiBold, FONT_BANNER);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);

	const forestImg = useImage(require('@/src/assets/img/games/race/bg-forest.png'));
	const crowdImg = useImage(require('@/src/assets/img/games/race/crowd.png'));
	const trackImg = useImage(require('@/src/assets/img/games/race/track.png'));
	const finishImg = useImage(require('@/src/assets/img/games/race/finish.png'));
	const runner0Img = useImage(require('@/src/assets/img/games/race/runner0.png'));
	const runner1Img = useImage(require('@/src/assets/img/games/race/runner1.png'));
	const runner2Img = useImage(require('@/src/assets/img/games/race/runner2.png'));
	const runner3Img = useImage(require('@/src/assets/img/games/race/runner3.png'));

	const goText = t('settings:aiTrainer.coach.go');
	const placeTexts = [
		t('settings:aiTrainer.games.race.place1'),
		t('settings:aiTrainer.games.race.place2'),
		t('settings:aiTrainer.games.race.place3'),
		t('settings:aiTrainer.games.race.place4'),
	];

	const worldPx = useDerivedValue(() => engine.playerDist.value * G.PX_PER_M);

	const pausedStyle = useAnimatedStyle(() => ({
		opacity: withTiming(engine.paused.value ? 1 : 0, { duration: 200 }),
	}));
	const calibrateStyle = useAnimatedStyle(() => ({
		opacity: withTiming(engine.running.value && engine.awaitingRep.value ? 1 : 0, { duration: 200 }),
	}));

	// --- HUD strings (all derived, no React state) ---
	const placeText = useDerivedValue(() => placeTexts[Math.min(3, Math.max(0, engine.rank.value - 1))]);
	const placeColor = useDerivedValue(() => (engine.rank.value === 1 ? C.placeGold : C.placeGrey));
	const raceInfoText = useDerivedValue(() => {
		const left = Math.max(0, Math.ceil(P.RACE_LENGTH_M - engine.playerDist.value));
		const total = Math.floor(engine.elapsedMs.value / 1000);
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${left} m · ${m}:${s < 10 ? '0' : ''}${s}`;
	});
	const nearestGap = useDerivedValue(
		() =>
			engine.playerDist.value -
			Math.max(engine.botDist0.value, engine.botDist1.value, engine.botDist2.value),
	);
	const gapText = useDerivedValue(() => {
		const gap = Math.round(nearestGap.value);
		return gap >= 0 ? `+${gap} m` : `${gap} m`;
	});
	const gapColor = useDerivedValue(() => (nearestGap.value >= 0 ? C.gapAhead : C.gapBehind));
	const goOpacity = useDerivedValue(() => engine.goT.value);

	if (!size) {
		return <View style={styles.root} onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} />;
	}

	const { w: W, h: H } = size;
	const trackTop = H * G.TRACK_TOP_FRAC;
	const trackH = H - trackTop;
	const runnerH = H * G.RUNNER_H_FRAC;
	const playerX = W * G.PLAYER_X_FRAC;

	const crowdH = H * 0.07;
	const crowdY = trackTop - crowdH;
	const crowdTileW = 512 * (crowdH / 64);
	const forestH = crowdY + 24;
	const forestW = forestH;
	const trackTileW = 512 * (trackH / 160);
	const finishH = trackH * 0.95;
	const finishW = 360 * (finishH / 400);

	const lanes = [
		{ y: trackTop + trackH * 0.38, scale: 0.8 },
		{ y: trackTop + trackH * 0.55, scale: 0.87 },
		{ y: trackTop + trackH * 0.72, scale: 0.94 },
		{ y: trackTop + trackH * 0.9, scale: 1 },
	];

	const hudY = topInset + 56;
	const progressY = H - 96;
	const progressW = W - 32;

	return (
		<View style={styles.root}>
			<Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
				{[0, 1, 2].map(copy => (
					<ParallaxTile key={`f${copy}`} image={forestImg} worldPx={worldPx} factor={G.PARALLAX_BG} y={0} tileW={forestW} tileH={forestH} copy={copy} />
				))}
				{[0, 1, 2].map(copy => (
					<ParallaxTile key={`cr${copy}`} image={crowdImg} worldPx={worldPx} factor={G.PARALLAX_CROWD} y={crowdY} tileW={crowdTileW} tileH={crowdH} copy={copy} />
				))}
				{[0, 1].map(copy => (
					<ParallaxTile key={`t${copy}`} image={trackImg} worldPx={worldPx} factor={1} y={trackTop} tileW={trackTileW} tileH={trackH} copy={copy} />
				))}
				<FinishBanner image={finishImg} playerDist={engine.playerDist} playerX={playerX} y={trackTop + trackH * 0.02} drawW={finishW} drawH={finishH} screenW={W} />
				<Runner image={runner1Img} dist={engine.botDist0} speed={engine.botSpeed0} playerDist={engine.playerDist} isPlayer={false} playerX={playerX} laneY={lanes[0].y} scale={lanes[0].scale} drawH={runnerH} screenW={W} />
				<Runner image={runner2Img} dist={engine.botDist1} speed={engine.botSpeed1} playerDist={engine.playerDist} isPlayer={false} playerX={playerX} laneY={lanes[1].y} scale={lanes[1].scale} drawH={runnerH} screenW={W} />
				<Runner image={runner3Img} dist={engine.botDist2} speed={engine.botSpeed2} playerDist={engine.playerDist} isPlayer={false} playerX={playerX} laneY={lanes[2].y} scale={lanes[2].scale} drawH={runnerH} screenW={W} />
				<SpeedStreak engine={engine} playerX={playerX} laneY={lanes[3].y} drawH={runnerH} offsetY={runnerH * 0.3} length={34} />
				<SpeedStreak engine={engine} playerX={playerX} laneY={lanes[3].y} drawH={runnerH} offsetY={runnerH * 0.55} length={48} />
				<SpeedStreak engine={engine} playerX={playerX} laneY={lanes[3].y} drawH={runnerH} offsetY={runnerH * 0.8} length={28} />
				<Runner image={runner0Img} dist={engine.playerDist} speed={engine.playerSpeed} playerDist={engine.playerDist} isPlayer playerX={playerX} laneY={lanes[3].y} scale={lanes[3].scale} drawH={runnerH} screenW={W} />

				<RoundedRect x={16} y={hudY} width={78} height={40} r={20} color={C.hudPill} />
				{fontBadge && <SkiaText x={32} y={hudY + 28} text={placeText} font={fontBadge} color={placeColor} />}
				<RoundedRect x={102} y={hudY} width={126} height={40} r={20} color={C.hudPill} />
				{fontHud && <SkiaText x={118} y={hudY + 26} text={raceInfoText} font={fontHud} color={C.hudText} />}
				<RoundedRect x={16} y={hudY + 48} width={78} height={32} r={16} color={C.hudPill} />
				{fontHud && <SkiaText x={30} y={hudY + 70} text={gapText} font={fontHud} color={gapColor} />}

				<RoundedRect x={16} y={progressY} width={progressW} height={8} r={4} color={C.progressBack} />
				<ProgressDot dist={engine.botDist0} x0={16} barW={progressW} y={progressY + 4} r={5} color={C.botDot} />
				<ProgressDot dist={engine.botDist1} x0={16} barW={progressW} y={progressY + 4} r={5} color={C.botDot} />
				<ProgressDot dist={engine.botDist2} x0={16} barW={progressW} y={progressY + 4} r={5} color={C.botDot} />
				<ProgressDot dist={engine.playerDist} x0={16} barW={progressW} y={progressY + 4} r={7} color={C.playerDot} />

				{fontBanner && (
					<Group opacity={goOpacity}>
						<SkiaText x={W / 2 - fontBanner.measureText(goText).width / 2} y={H * 0.4} text={goText} font={fontBanner} color={C.bannerText} />
					</Group>
				)}
			</Canvas>
			<Animated.View style={[styles.hintOverlay, calibrateStyle]} pointerEvents="none">
				<Text style={styles.hintText}>{t('settings:aiTrainer.games.race.calibrate')}</Text>
			</Animated.View>
			<Animated.View style={[styles.pausedOverlay, pausedStyle]} pointerEvents="none">
				<Text style={styles.pausedText}>{t('settings:aiTrainer.games.stepBack')}</Text>
			</Animated.View>
		</View>
	);
});

RaceScene.displayName = 'RaceScene';

interface FinishBannerProps {
	image: SkImage | null;
	playerDist: SharedValue<number>;
	playerX: number;
	y: number;
	drawW: number;
	drawH: number;
	screenW: number;
}

/** The finish arch scrolls in from the right as the athlete nears the line. */
const FinishBanner = ({ image, playerDist, playerX, y, drawW, drawH, screenW }: FinishBannerProps) => {
	const x = useDerivedValue(() => {
		const px = playerX + (P.RACE_LENGTH_M - playerDist.value) * G.PX_PER_M;
		return px > screenW + drawW ? OFFSCREEN : px - drawW / 2;
	});
	if (!image) return null;
	return <SkiaImage image={image} x={x} y={y} width={drawW} height={drawH} fit="fill" />;
};

interface ProgressDotProps {
	dist: SharedValue<number>;
	x0: number;
	barW: number;
	y: number;
	r: number;
	color: string;
}

/** A runner's dot on the race progress bar. */
const ProgressDot = ({ dist, x0, barW, y, r, color }: ProgressDotProps) => {
	const cx = useDerivedValue(
		() => x0 + Math.min(1, Math.max(0, dist.value / P.RACE_LENGTH_M)) * barW,
	);
	return <Circle cx={cx} cy={y} r={r} color={color} />;
};

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#D3EEF7',
		overflow: 'hidden',
	},
	pausedOverlay: {
		...StyleSheet.absoluteFillObject,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: 'rgba(0,0,0,0.25)',
	},
	pausedText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '700',
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 16,
		backgroundColor: 'rgba(0,0,0,0.55)',
		overflow: 'hidden',
	},
	hintOverlay: {
		...StyleSheet.absoluteFillObject,
		alignItems: 'center',
		justifyContent: 'center',
	},
	hintText: {
		color: '#fff',
		fontSize: 17,
		fontWeight: '800',
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 18,
		backgroundColor: 'rgba(23,55,83,0.7)',
		overflow: 'hidden',
	},
});
