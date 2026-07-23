import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
	Canvas,
	Circle,
	Group,
	Path,
	Rect,
	RoundedRect,
	Skia,
	Text as SkiaText,
	useFont,
} from '@shopify/react-native-skia';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import interSemiBold from '@/src/assets/fonts/Inter-SemiBold.ttf';

import { FLAPPY_COLORS, FLAPPY_GEOMETRY } from './flappyConfig';
import { bottomPipeTopY, topPipeBottomY } from './gate';
import { slotWorldX, type FlappyEngine } from './useFlappyEngine';

const C = FLAPPY_COLORS;
const PIPE_RADIUS = 6;
const OFFSCREEN = -9999;
// Slots are two pipe-widths wide, so up to ~4 are visible at once; spares
// cover edge transitions — the spec's object pool.
const SLOT_COUNT = 7;
const SCORE_FONT_SIZE = 20;
const COUNTDOWN_FONT_SIZE = 64;
// How long "GO!" stays on screen after the countdown, in world-scroll pixels.
const GO_SHOWN_WORLD_FRAC = 0.25;

interface FlappyGameBandProps {
	engine: FlappyEngine;
}

interface PipeSlotProps {
	engine: FlappyEngine;
	slot: number;
}

/**
 * One pooled pipe-pair slot: flat pipe bodies, cap lips at the gap edges, and
 * the gap coin. The slot re-maps itself to whichever gate index scrolls into
 * view — no allocation during the game.
 */
const PipeSlot = ({ engine, slot }: PipeSlotProps) => {
	const slotGate = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		const level = engine.levelSV.value;
		if (!geom || !level) return -1;
		const spacing = geom.pipeW * FLAPPY_GEOMETRY.SLOT_WIDTH_PIPES;
		// First level index whose slot is not yet fully off the LEFT edge:
		// slot i sits at screen x = bandW + i·spacing − worldX.
		const firstCandidate = Math.max(
			0,
			Math.ceil((engine.worldX.value - geom.bandW - geom.pipeW * 2) / spacing),
		);
		const idx = firstCandidate + slot;
		return idx < level.topFrac.length ? idx : -1;
	});

	const screenX = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		const level = engine.levelSV.value;
		const idx = slotGate.value;
		if (!geom || !level || idx < 0 || !level.hasPipe[idx]) return OFFSCREEN;
		const x = slotWorldX(idx, geom) - engine.worldX.value;
		return x > geom.bandW + geom.pipeW || x < -geom.pipeW * 2 ? OFFSCREEN : x;
	});

	const pipeW = useDerivedValue(() => engine.geomSV.value?.pipeW ?? 0);
	const capH = useDerivedValue(() => (engine.geomSV.value?.pipeW ?? 0) * 0.28);
	const capX = useDerivedValue(() => screenX.value - (engine.geomSV.value?.pipeW ?? 0) * 0.08);
	const capW = useDerivedValue(() => (engine.geomSV.value?.pipeW ?? 0) * 1.16);

	const topPipeH = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		const level = engine.levelSV.value;
		const idx = slotGate.value;
		if (!geom || !level || idx < 0) return 0;
		const frac = level.topFrac[idx];
		return frac > 0 ? topPipeBottomY(frac, geom) : 0;
	});
	const topCapY = useDerivedValue(() => topPipeH.value - capH.value);

	const bottomPipeY = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		const level = engine.levelSV.value;
		const idx = slotGate.value;
		if (!geom || !level || idx < 0) return 0;
		return bottomPipeTopY(level.bottomFrac[idx], geom);
	});
	const bottomPipeH = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		const level = engine.levelSV.value;
		const idx = slotGate.value;
		if (!geom || !level || idx < 0) return 0;
		return level.bottomFrac[idx] > 0 ? geom.bandH - bottomPipeY.value : 0;
	});
	const topCapOpacity = useDerivedValue(() => (topPipeH.value > 0 ? 1 : 0));
	const bottomCapOpacity = useDerivedValue(() => (bottomPipeH.value > 0 ? 1 : 0));

	const coinX = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		return geom && screenX.value > OFFSCREEN ? screenX.value + geom.pipeW / 2 : OFFSCREEN;
	});
	const coinY = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		const level = engine.levelSV.value;
		const idx = slotGate.value;
		if (!geom || !level || idx < 0) return 0;
		return (topPipeBottomY(level.topFrac[idx], geom) + bottomPipeTopY(level.bottomFrac[idx], geom)) / 2;
	});
	const coinOpacity = useDerivedValue(() => {
		const idx = slotGate.value;
		if (idx < 0) return 0;
		return idx === engine.coinGoneA.value || idx === engine.coinGoneB.value ? 0 : 1;
	});
	const coinR = useDerivedValue(() => engine.geomSV.value?.coinR ?? 0);
	const coinInnerR = useDerivedValue(() => coinR.value * 0.62);

	return (
		<>
			<RoundedRect x={screenX} y={0} width={pipeW} height={topPipeH} r={PIPE_RADIUS} color={C.pipeMid} />
			<RoundedRect x={capX} y={topCapY} width={capW} height={capH} r={PIPE_RADIUS} color={C.pipeCap} opacity={topCapOpacity} />
			<RoundedRect x={screenX} y={bottomPipeY} width={pipeW} height={bottomPipeH} r={PIPE_RADIUS} color={C.pipeMid} />
			<RoundedRect x={capX} y={bottomPipeY} width={capW} height={capH} r={PIPE_RADIUS} color={C.pipeCap} opacity={bottomCapOpacity} />
			<Circle cx={coinX} cy={coinY} r={coinR} color={C.coin} opacity={coinOpacity} />
			<Circle cx={coinX} cy={coinY} r={coinInnerR} color={C.coinInner} opacity={coinOpacity} />
		</>
	);
};

/**
 * The Flappy Push game band, tuned for reliability and light weight: flat
 * colors, a pooled set of pipe slots, and the drawn bird — every animated
 * prop derived from shared values with no per-frame scenery. The 3-2-1-GO
 * countdown renders as Skia text straight off the engine's UI-thread clock,
 * so it can never lag behind the real beats.
 */
export const FlappyGameBand = React.memo(({ engine }: FlappyGameBandProps) => {
	const { t } = useTranslation(['settings']);
	const font = useFont(interSemiBold, SCORE_FONT_SIZE);
	const countdownFont = useFont(interSemiBold, COUNTDOWN_FONT_SIZE);
	const goText = t('settings:aiTrainer.coach.go');

	const bandW = useDerivedValue(() => engine.geomSV.value?.bandW ?? 0);
	const bandH = useDerivedValue(() => engine.geomSV.value?.bandH ?? 0);
	const sunX = useDerivedValue(() => bandW.value - 52);

	// --- Bird: round body, belly, flapping wing, beak, eye ---
	const planeTransform = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		if (!geom) return [{ translateX: OFFSCREEN }];
		const planeY = geom.playTop + (1 - engine.smoothedPos.value) * geom.playH;
		return [{ translateX: geom.planeX }, { translateY: planeY }, { rotate: engine.tilt.value }];
	});
	const birdR = useDerivedValue(() => (engine.geomSV.value?.planeH ?? 0) * 1.1);
	const bellyX = useDerivedValue(() => birdR.value * 0.12);
	const bellyY = useDerivedValue(() => birdR.value * 0.38);
	const bellyR = useDerivedValue(() => birdR.value * 0.58);
	const eyeX = useDerivedValue(() => birdR.value * 0.42);
	const eyeY = useDerivedValue(() => -birdR.value * 0.3);
	const eyeR = useDerivedValue(() => birdR.value * 0.3);
	const pupilX = useDerivedValue(() => birdR.value * 0.52);
	const pupilR = useDerivedValue(() => birdR.value * 0.14);
	const beakPath = useDerivedValue(() => {
		const p = Skia.Path.Make();
		const r = birdR.value;
		if (r === 0) return p;
		p.moveTo(r * 0.8, -r * 0.08);
		p.lineTo(r * 1.42, r * 0.06);
		p.lineTo(r * 0.78, r * 0.28);
		p.close();
		return p;
	});
	// Static wing shape; the flap is a rotation around its shoulder joint.
	const wingPath = useDerivedValue(() => {
		const p = Skia.Path.Make();
		const r = birdR.value;
		if (r === 0) return p;
		p.moveTo(-r * 0.1, -r * 0.05);
		p.quadTo(-r * 0.95, -r * 0.35, -r * 0.7, r * 0.45);
		p.quadTo(-r * 0.3, r * 0.5, 0, r * 0.28);
		p.close();
		return p;
	});
	const wingTransform = useDerivedValue(() => [
		{ rotate: Math.sin(engine.worldX.value / 12 + engine.smoothedPos.value * 7) * 0.35 },
	]);
	const hitTintR = useDerivedValue(() => birdR.value * 1.15);
	const hitTintOpacity = useDerivedValue(() => engine.hitFlash.value * 0.75);

	const flashOpacity = useDerivedValue(() => engine.hitFlash.value * 0.25);

	// --- HUD ---
	const scoreText = useDerivedValue(() => `${engine.score.value}`);
	const scorePillX = useDerivedValue(() => bandW.value - 76);
	const scoreTextX = useDerivedValue(() => {
		const digits = `${engine.score.value}`.length;
		return bandW.value - 44 - (digits - 1) * (SCORE_FONT_SIZE * 0.3);
	});

	// --- "GO!" flash right after the calibration rep, pure UI-thread ---
	const countdownText = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		if (
			engine.calibrated.value &&
			geom &&
			engine.worldX.value < geom.bandW * GO_SHOWN_WORLD_FRAC
		) {
			return goText;
		}
		return '';
	});
	const countdownX = useDerivedValue(() => {
		if (!countdownFont) return 0;
		const width = countdownFont.measureText(countdownText.value || ' ').width;
		return bandW.value / 2 - width / 2;
	});
	const countdownY = useDerivedValue(() => bandH.value / 2 + COUNTDOWN_FONT_SIZE * 0.36);

	const pausedStyle = useAnimatedStyle(() => ({
		opacity: withTiming(engine.paused.value ? 1 : 0, { duration: 200 }),
	}));

	// Only during active play, and never on top of the step-back overlay.
	const palmsStyle = useAnimatedStyle(() => ({
		opacity: withTiming(
			engine.running.value && engine.calibrated.value && !engine.paused.value && !engine.palmsPlanted.value
				? 1
				: 0,
			{ duration: 200 },
		),
	}));

	// "Do 1 push-up to start": driven by the engine's shared state on the UI
	// thread — no React round-trip, so it can never lag or stick.
	const calibrateStyle = useAnimatedStyle(() => ({
		opacity: withTiming(
			engine.running.value && engine.awaitingRep.value && !engine.paused.value ? 1 : 0,
			{ duration: 200 },
		),
	}));

	return (
		<View style={styles.root}>
			<Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
				<Circle cx={sunX} cy={44} r={24} color={C.sun} />
				{Array.from({ length: SLOT_COUNT }, (_, slot) => (
					<PipeSlot key={slot} engine={engine} slot={slot} />
				))}
				<Group transform={planeTransform}>
					<Group transform={wingTransform}>
						<Path path={wingPath} color={C.birdWing} />
					</Group>
					<Circle cx={0} cy={0} r={birdR} color={C.birdBody} />
					<Circle cx={bellyX} cy={bellyY} r={bellyR} color={C.birdBelly} />
					<Path path={beakPath} color={C.birdBeak} />
					<Circle cx={eyeX} cy={eyeY} r={eyeR} color={C.birdEyeWhite} />
					<Circle cx={pupilX} cy={eyeY} r={pupilR} color={C.birdEyePupil} />
					<Circle cx={0} cy={0} r={hitTintR} color={C.planeHit} opacity={hitTintOpacity} />
				</Group>
				<Rect x={0} y={0} width={bandW} height={bandH} color={C.flash} opacity={flashOpacity} />
				<RoundedRect x={scorePillX} y={12} width={64} height={34} r={17} color={C.scorePill} />
				{font && <SkiaText x={scoreTextX} y={36} text={scoreText} font={font} color={C.scoreText} />}
				{countdownFont && (
					<SkiaText x={countdownX} y={countdownY} text={countdownText} font={countdownFont} color={C.scoreText} />
				)}
			</Canvas>
			<Animated.View style={[styles.hintOverlay, calibrateStyle]} pointerEvents="none">
				<Text style={styles.hintText}>{t('settings:aiTrainer.games.flappy.calibrate')}</Text>
			</Animated.View>
			<Animated.View style={[styles.pausedOverlay, pausedStyle]} pointerEvents="none">
				<Text style={styles.pausedText}>{t('settings:aiTrainer.games.stepBack')}</Text>
			</Animated.View>
			<Animated.View style={[styles.warningOverlay, palmsStyle]} pointerEvents="none">
				<Text style={styles.pausedText}>{t('settings:aiTrainer.games.palmsDown')}</Text>
			</Animated.View>
		</View>
	);
});

FlappyGameBand.displayName = 'FlappyGameBand';

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: FLAPPY_COLORS.skyMid,
		overflow: 'hidden',
	},
	pausedOverlay: {
		...StyleSheet.absoluteFillObject,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: 'rgba(0,0,0,0.25)',
	},
	warningOverlay: {
		...StyleSheet.absoluteFillObject,
		alignItems: 'center',
		justifyContent: 'flex-start',
		paddingTop: 12,
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
