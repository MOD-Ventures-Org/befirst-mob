import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
	Canvas,
	Circle,
	FilterMode,
	Group,
	Image as SkiaImage,
	LinearGradient,
	MipmapMode,
	Oval,
	Path,
	Rect,
	RoundedRect,
	Skia,
	Text as SkiaText,
	useFont,
	useImage,
	vec,
	type SkFont,
	type SkImage,
} from '@shopify/react-native-skia';
import Animated, {
	type SharedValue,
	useAnimatedReaction,
	useAnimatedStyle,
	useDerivedValue,
	withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTranslation } from 'react-i18next';

import interSemiBold from '@/src/assets/fonts/Inter-SemiBold.ttf';

import { scatter } from './haul';
import { HAUL_LEVELS, HAULER_COLORS, type CargoType } from './haulerConfig';
import type { HaulerEngine } from './useHaulerEngine';

const C = HAULER_COLORS;
const FONT_HUD = 15;
const FONT_BADGE = 20;
const FONT_BANNER = 34;
const DUST_COUNT = 8;
const RUBBLE_COUNT = 12;
const DUST_LIFE_MS = 520;
const RUBBLE_LIFE_MS = 760;
const MAX_PILE = 6;
const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None } as const;

/** Native pixel size of each sprite, for aspect-correct draw sizing. */
const OGRE_ASPECT = 32 / 32;
const DEMON_ASPECT = 32 / 36;
const CARGO_ASPECT: Record<CargoType, number> = {
	rocks: 13 / 12,
	crate: 16 / 22,
	flask: 16 / 16,
	chest: 16 / 16,
	coin: 8 / 8,
};

interface HaulerSceneProps {
	engine: HaulerEngine;
	/** Safe-area top inset so the HUD clears the screen header. */
	topInset: number;
}

/**
 * The full-screen Push Hauler scene: a fixed-camera dungeon ramp rising from a
 * bottom-left quarry to a top platform. A real animated pixel-art ogre (CC0
 * 0x72 Dungeon Tileset II) walks the ramp carrying the level's cargo, one step
 * per push-up, drops it on a growing pile up top (thud + shake + dust), walks
 * back down for the next piece, and a demon hauls the final gold. Positions
 * derive from the engine's shared values (no React re-renders while hauling);
 * only the rare level change crosses to React to swap the monster, cargo, and
 * biome tint.
 */
export const HaulerScene = React.memo(({ engine, topInset }: HaulerSceneProps) => {
	const { t } = useTranslation(['settings']);
	const fontHud = useFont(interSemiBold, FONT_HUD);
	const fontBadge = useFont(interSemiBold, FONT_BADGE);
	const fontBanner = useFont(interSemiBold, FONT_BANNER);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const [levelIdx, setLevelIdx] = useState(0);

	// Real CC0 pixel-art sprites.
	const ogreRun = [
		useImage(require('@/src/assets/img/games/hauler/ogre_run_anim_f0.png')),
		useImage(require('@/src/assets/img/games/hauler/ogre_run_anim_f1.png')),
		useImage(require('@/src/assets/img/games/hauler/ogre_run_anim_f2.png')),
		useImage(require('@/src/assets/img/games/hauler/ogre_run_anim_f3.png')),
	];
	const ogreIdle = [
		useImage(require('@/src/assets/img/games/hauler/ogre_idle_anim_f0.png')),
		useImage(require('@/src/assets/img/games/hauler/ogre_idle_anim_f1.png')),
		useImage(require('@/src/assets/img/games/hauler/ogre_idle_anim_f2.png')),
		useImage(require('@/src/assets/img/games/hauler/ogre_idle_anim_f3.png')),
	];
	const demonRun = [
		useImage(require('@/src/assets/img/games/hauler/big_demon_run_anim_f0.png')),
		useImage(require('@/src/assets/img/games/hauler/big_demon_run_anim_f1.png')),
		useImage(require('@/src/assets/img/games/hauler/big_demon_run_anim_f2.png')),
		useImage(require('@/src/assets/img/games/hauler/big_demon_run_anim_f3.png')),
	];
	const demonIdle = [
		useImage(require('@/src/assets/img/games/hauler/big_demon_idle_anim_f0.png')),
		useImage(require('@/src/assets/img/games/hauler/big_demon_idle_anim_f1.png')),
		useImage(require('@/src/assets/img/games/hauler/big_demon_idle_anim_f2.png')),
		useImage(require('@/src/assets/img/games/hauler/big_demon_idle_anim_f3.png')),
	];
	const cargoImgs: Record<CargoType, SkImage | null> = {
		rocks: useImage(require('@/src/assets/img/games/hauler/Rocks.png')),
		crate: useImage(require('@/src/assets/img/games/hauler/crate.png')),
		flask: useImage(require('@/src/assets/img/games/hauler/flask_big_red.png')),
		chest: useImage(require('@/src/assets/img/games/hauler/chest_full_open_anim_f0.png')),
		coin: useImage(require('@/src/assets/img/games/hauler/coin_anim_f0.png')),
	};
	const wallMidImg = useImage(require('@/src/assets/img/games/hauler/wall_mid.png'));
	const wallTopImg = useImage(require('@/src/assets/img/games/hauler/wall_top_mid.png'));
	const floorImg = useImage(require('@/src/assets/img/games/hauler/floor_1.png'));

	// Only React bridge: swap monster/cargo/biome when the level changes.
	useAnimatedReaction(
		() => engine.levelIndex.value,
		(next, prev) => {
			if (next !== prev) scheduleOnRN(setLevelIdx, next);
		},
	);

	const level = HAUL_LEVELS[Math.min(HAUL_LEVELS.length - 1, levelIdx)];
	const isDemon = level.monster === 'demon';
	const runFrames = isDemon ? demonRun : ogreRun;
	const idleFrames = isDemon ? demonIdle : ogreIdle;
	const monsterAspect = isDemon ? DEMON_ASPECT : OGRE_ASPECT;
	const cargoImg = cargoImgs[level.cargo];
	const cargoAspect = CARGO_ASPECT[level.cargo];
	const levelNames = HAUL_LEVELS.map(l => t(`settings:aiTrainer.games.hauler.levels.${l.nameKey}`));

	// shown: 0 = at the quarry base, 1 = on the top platform. Carry rises with
	// the load; the empty return trip walks the ramp back down.
	const shown = useDerivedValue(() =>
		engine.phase.value === 1 ? 1 - engine.returnT.value : engine.climb.value,
	);
	// Animation frame: run cycle while stepping, idle breathing between reps.
	const frameSel = useDerivedValue(() => {
		const moving = engine.heaveT.value > 0.06;
		return Math.floor(engine.nowMs.value / (moving ? 90 : 220)) % 4;
	});
	const movingFlag = useDerivedValue<number>(() => (engine.heaveT.value > 0.06 ? 1 : 0));

	const levelText = useDerivedValue(() => `L${engine.levelIndex.value + 1}`);
	const cargoText = useDerivedValue(() => {
		const lvl = HAUL_LEVELS[Math.min(HAUL_LEVELS.length - 1, engine.levelIndex.value)];
		return `${engine.deliveredInLevel.value}/${lvl.count}`;
	});
	const weightText = useDerivedValue(() => `${Math.round(engine.weightKg.value)} kg`);
	const bannerLine = useDerivedValue(() =>
		levelNames[Math.min(levelNames.length - 1, engine.levelIndex.value)],
	);
	const bannerOpacity = useDerivedValue(() => engine.bannerT.value);

	const pausedStyle = useAnimatedStyle(() => ({
		opacity: withTiming(engine.paused.value ? 1 : 0, { duration: 200 }),
	}));
	const calibrateStyle = useAnimatedStyle(() => ({
		opacity: withTiming(engine.running.value && engine.awaitingRep.value ? 1 : 0, { duration: 200 }),
	}));

	const shakeTransform = useDerivedValue(() => {
		const s = engine.shakeT.value;
		const n = engine.nowMs.value;
		return [{ translateX: s * 6 * Math.sin(n / 24) }, { translateY: s * 5 * Math.sin(n / 17) }];
	});

	// Layout constants (0 until first onLayout); computed before the early return
	// so every hook below runs in a stable order.
	const W = size?.w ?? 0;
	const H = size?.h ?? 0;
	const p0x = W * 0.2;
	const p0y = H * 0.82;
	const p1x = W * 0.6;
	const p1y = H * 0.3;
	const monsterH = H * 0.19;
	const monsterW = monsterH * monsterAspect;
	const cargoH = monsterH * 0.55;
	const cargoW = cargoH * cargoAspect;
	const hudY = topInset + 52;
	const gaugeX = W - 22;
	const gaugeTop = H * 0.2;
	const gaugeH = H * 0.4;

	const monsterTransform = useDerivedValue(() => {
		const s = shown.value;
		const mx = p0x + (p1x - p0x) * s;
		const my = p0y + (p1y - p0y) * s;
		const scale = 1 - 0.22 * s;
		const bob = movingFlag.value ? Math.sin(engine.nowMs.value / 55) * (monsterH * 0.04) : 0;
		const flip = engine.phase.value === 1 ? -1 : 1;
		return [{ translateX: mx }, { translateY: my + bob }, { scale }, { scaleX: flip }];
	});
	const cargoOpacity = useDerivedValue(() =>
		engine.phase.value === 1 ? 1 - engine.returnT.value : 1,
	);
	const gaugeMarkerCy = useDerivedValue(() => gaugeTop + gaugeH * (1 - Math.min(1, shown.value)));
	const dropX = p1x;
	const dropY = p1y;

	if (!size) {
		return (
			<View
				style={styles.root}
				onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
			/>
		);
	}

	return (
		<View style={styles.root}>
			<Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
				<Rect x={0} y={0} width={W} height={H}>
					<LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={[level.skyTop, level.skyBottom]} />
				</Rect>

				<Group transform={shakeTransform}>
					<WallBackdrop W={W} H={H} wallMid={wallMidImg} wallTop={wallTopImg} />
					<Ramp W={W} H={H} p0x={p0x} p0y={p0y} p1x={p1x} p1y={p1y} monsterH={monsterH} floor={floorImg} />

					{/* Waiting cargo at the quarry base */}
					{Array.from({ length: MAX_PILE }, (_, i) => (
						<WaitSprite key={`w${i}`} index={i} image={cargoImg} baseX={W * 0.04} baseY={p0y + monsterH * 0.02} cw={cargoW} ch={cargoH} count={level.count} delivered={engine.deliveredInLevel} />
					))}

					{/* Delivered pile on the top platform */}
					{Array.from({ length: MAX_PILE }, (_, i) => (
						<PileSprite key={`p${i}`} index={i} image={cargoImg} baseX={p1x + monsterW * 0.2} baseY={p1y + monsterH * 0.04} cw={cargoW} ch={cargoH} delivered={engine.deliveredInLevel} />
					))}

					{/* Foot dust */}
					<DustField engine={engine} p0x={p0x} p0y={p0y} p1x={p1x} p1y={p1y} monsterH={monsterH} />

					{/* The hauler */}
					<Group transform={monsterTransform}>
						<Oval x={-monsterW * 0.38} y={-monsterH * 0.03} width={monsterW * 0.76} height={monsterH * 0.13} color="#000000" opacity={0.26} />
						{runFrames.map((img, k) => (
							<MonsterFrame key={`r${k}`} image={img} myIndex={k} isMoving={1} frameSel={frameSel} moving={movingFlag} w={monsterW} h={monsterH} />
						))}
						{idleFrames.map((img, k) => (
							<MonsterFrame key={`i${k}`} image={img} myIndex={k} isMoving={0} frameSel={frameSel} moving={movingFlag} w={monsterW} h={monsterH} />
						))}
						<Group opacity={cargoOpacity}>
							<SkiaImage image={cargoImg} x={-cargoW / 2} y={-monsterH * 0.44 - cargoH * 0.5} width={cargoW} height={cargoH} sampling={NEAREST} fit="contain" />
						</Group>
					</Group>

					{/* Delivery rubble */}
					<Rubble engine={engine} x={dropX} y={dropY} />
				</Group>

				{/* HUD */}
				<RoundedRect x={16} y={hudY} width={70} height={38} r={19} color={C.hudPill} />
				{fontBadge && <SkiaText x={30} y={hudY + 26} text={levelText} font={fontBadge} color={C.hudAccent} />}
				<RoundedRect x={94} y={hudY} width={78} height={38} r={19} color={C.hudPill} />
				{fontHud && <SkiaText x={108} y={hudY + 24} text={cargoText} font={fontHud} color={C.hudText} />}
				<RoundedRect x={180} y={hudY} width={98} height={38} r={19} color={C.hudPill} />
				{fontHud && <SkiaText x={194} y={hudY + 24} text={weightText} font={fontHud} color={C.hudText} />}

				<RoundedRect x={gaugeX - 4} y={gaugeTop} width={8} height={gaugeH} r={4} color={C.gaugeBack} />
				<GaugeFill x={gaugeX} topY={gaugeTop} gaugeH={gaugeH} shown={shown} />
				<Circle cx={gaugeX} cy={gaugeMarkerCy} r={7} color={C.hudAccent} />

				{fontBanner && (
					<Group opacity={bannerOpacity}>
						<BannerText W={W} H={H} font={fontBanner} text={bannerLine} />
					</Group>
				)}
			</Canvas>

			<Animated.View style={[styles.hintOverlay, calibrateStyle]} pointerEvents="none">
				<Text style={styles.hintText}>{t('settings:aiTrainer.games.hauler.calibrate')}</Text>
			</Animated.View>
			<Animated.View style={[styles.pausedOverlay, pausedStyle]} pointerEvents="none">
				<Text style={styles.pausedText}>{t('settings:aiTrainer.games.stepBack')}</Text>
			</Animated.View>
		</View>
	);
});

HaulerScene.displayName = 'HaulerScene';

// ---------------------------------------------------------------------------
// Ramp + dungeon structure
// ---------------------------------------------------------------------------

interface WallBackdropProps {
	W: number;
	H: number;
	wallMid: SkImage | null;
	wallTop: SkImage | null;
}

/**
 * A tiled stone-brick dungeon wall behind the whole scene, capped with a top
 * row and dimmed with a dark gradient so it reads as depth, not clutter.
 */
const WallBackdrop = ({ W, H, wallMid, wallTop }: WallBackdropProps) => {
	const T = Math.ceil(W / 6);
	const cols = Math.ceil(W / T) + 1;
	const rows = Math.ceil((H * 0.72) / T);
	return (
		<Group>
			{Array.from({ length: rows }, (_, r) =>
				Array.from({ length: cols }, (_, c) => (
					<SkiaImage key={`wl${r}-${c}`} image={r === 0 ? wallTop : wallMid} x={c * T} y={r * T} width={T} height={T} sampling={NEAREST} fit="fill" />
				)),
			)}
			<Rect x={0} y={0} width={W} height={H}>
				<LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={['rgba(10,12,16,0.35)', 'rgba(10,12,16,0.82)']} />
			</Rect>
		</Group>
	);
};

interface RampProps {
	W: number;
	H: number;
	p0x: number;
	p0y: number;
	p1x: number;
	p1y: number;
	monsterH: number;
	floor: SkImage | null;
}

/** The stone ramp the ogre climbs, with a foot-line edge, steps and platform. */
const Ramp = ({ W, H, p0x, p0y, p1x, p1y, monsterH, floor }: RampProps) => {
	const foot = monsterH * 0.06;
	const body = Skia.Path.Make();
	body.moveTo(0, H);
	body.lineTo(0, p0y + foot);
	body.lineTo(p0x, p0y + foot);
	body.lineTo(p1x, p1y + foot);
	body.lineTo(W, p1y + foot);
	body.lineTo(W, H);
	body.close();

	const edge = Skia.Path.Make();
	edge.moveTo(0, p0y + foot);
	edge.lineTo(p0x, p0y + foot);
	edge.lineTo(p1x, p1y + foot);
	edge.lineTo(W, p1y + foot);

	// Step notches down the incline.
	const steps = Skia.Path.Make();
	const STEP_N = 7;
	for (let i = 1; i < STEP_N; i += 1) {
		const s = i / STEP_N;
		const sx = p0x + (p1x - p0x) * s;
		const sy = p0y + (p1y - p0y) * s + foot;
		steps.moveTo(sx, sy);
		steps.lineTo(sx, sy + monsterH * 0.14);
	}

	const platY = p1y + foot;
	const baseY = p0y + foot;
	const tile = monsterH * 0.3;
	const platTiles = Math.ceil((W - p1x) / tile) + 1;
	const baseTiles = Math.ceil(p0x / tile) + 1;

	return (
		<Group>
			<Path path={body} color={C.rampFace} />
			<Path path={edge} color={C.rampTop} style="stroke" strokeWidth={monsterH * 0.12} strokeCap="round" />
			<Path path={steps} color="rgba(0,0,0,0.28)" style="stroke" strokeWidth={2} />
			{/* real stone floor on the flat platform and quarry base */}
			{Array.from({ length: platTiles }, (_, i) => (
				<SkiaImage key={`pf${i}`} image={floor} x={p1x + i * tile} y={platY - tile} width={tile} height={tile} sampling={NEAREST} fit="fill" />
			))}
			{Array.from({ length: baseTiles }, (_, i) => (
				<SkiaImage key={`bf${i}`} image={floor} x={i * tile} y={baseY - tile} width={tile} height={tile} sampling={NEAREST} fit="fill" />
			))}
		</Group>
	);
};

// ---------------------------------------------------------------------------
// The hauler
// ---------------------------------------------------------------------------

interface MonsterFrameProps {
	image: SkImage | null;
	myIndex: number;
	isMoving: 0 | 1;
	frameSel: SharedValue<number>;
	moving: SharedValue<number>;
	w: number;
	h: number;
}

/** One sprite frame, shown only when it is the active run/idle frame. */
const MonsterFrame = ({ image, myIndex, isMoving, frameSel, moving, w, h }: MonsterFrameProps) => {
	const opacity = useDerivedValue(() =>
		moving.value === isMoving && frameSel.value === myIndex ? 1 : 0,
	);
	return <Group opacity={opacity}><SkiaImage image={image} x={-w / 2} y={-h} width={w} height={h} sampling={NEAREST} fit="fill" /></Group>;
};

// ---------------------------------------------------------------------------
// Cargo piles
// ---------------------------------------------------------------------------

interface PileSpriteProps {
	index: number;
	image: SkImage | null;
	baseX: number;
	baseY: number;
	cw: number;
	ch: number;
	delivered: SharedValue<number>;
}

/** One delivered cargo sprite stacked on the top platform. */
const PileSprite = ({ index, image, baseX, baseY, cw, ch, delivered }: PileSpriteProps) => {
	const col = index % 2;
	const row = Math.floor(index / 2);
	const x = baseX + col * cw * 1.05;
	const y = baseY - ch - row * ch * 0.82;
	const opacity = useDerivedValue(() => (index < delivered.value ? 1 : 0));
	return (
		<Group opacity={opacity}>
			<SkiaImage image={image} x={x} y={y} width={cw} height={ch} sampling={NEAREST} fit="contain" />
		</Group>
	);
};

interface WaitSpriteProps {
	index: number;
	image: SkImage | null;
	baseX: number;
	baseY: number;
	cw: number;
	ch: number;
	count: number;
	delivered: SharedValue<number>;
}

/** One waiting cargo sprite at the quarry base, hidden once hauled. */
const WaitSprite = ({ index, image, baseX, baseY, cw, ch, count, delivered }: WaitSpriteProps) => {
	const col = index % 2;
	const row = Math.floor(index / 2);
	const x = baseX + col * cw * 1.05;
	const y = baseY - ch - row * ch * 0.82;
	const opacity = useDerivedValue(() => (index < count - delivered.value ? 1 : 0));
	return (
		<Group opacity={opacity}>
			<SkiaImage image={image} x={x} y={y} width={cw} height={ch} sampling={NEAREST} fit="contain" />
		</Group>
	);
};

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

interface DustFieldProps {
	engine: HaulerEngine;
	p0x: number;
	p0y: number;
	p1x: number;
	p1y: number;
	monsterH: number;
}

/** Foot dust kicked up on each step, tracking the ogre's ramp position. */
const DustField = ({ engine, p0x, p0y, p1x, p1y, monsterH }: DustFieldProps) => (
	<Group>
		{Array.from({ length: DUST_COUNT }, (_, i) => (
			<DustParticle key={`d${i}`} index={i} engine={engine} p0x={p0x} p0y={p0y} p1x={p1x} p1y={p1y} monsterH={monsterH} />
		))}
	</Group>
);

interface DustParticleProps {
	index: number;
	engine: HaulerEngine;
	p0x: number;
	p0y: number;
	p1x: number;
	p1y: number;
	monsterH: number;
}

const DustParticle = ({ index, engine, p0x, p0y, p1x, p1y, monsterH }: DustParticleProps) => {
	const cx = useDerivedValue(() => {
		const s = engine.phase.value === 1 ? 1 - engine.returnT.value : engine.climb.value;
		const footX = p0x + (p1x - p0x) * s;
		const p = Math.min(1, Math.max(0, (engine.nowMs.value - engine.heaveAt.value) / DUST_LIFE_MS));
		return footX + scatter(index, 1) * monsterH * 0.28 * (0.4 + p);
	});
	const cy = useDerivedValue(() => {
		const s = engine.phase.value === 1 ? 1 - engine.returnT.value : engine.climb.value;
		const footY = p0y + (p1y - p0y) * s;
		const p = Math.min(1, Math.max(0, (engine.nowMs.value - engine.heaveAt.value) / DUST_LIFE_MS));
		return footY - p * monsterH * 0.16 - Math.abs(scatter(index, 2)) * monsterH * 0.05;
	});
	const r = useDerivedValue(() => {
		const p = Math.min(1, Math.max(0, (engine.nowMs.value - engine.heaveAt.value) / DUST_LIFE_MS));
		return (1 - p) * monsterH * 0.07 + monsterH * 0.02;
	});
	const opacity = useDerivedValue(() => {
		const p = (engine.nowMs.value - engine.heaveAt.value) / DUST_LIFE_MS;
		return p < 0 || p > 1 ? 0 : (1 - p) * 0.55;
	});
	return <Circle cx={cx} cy={cy} r={r} color={C.dust} opacity={opacity} />;
};

interface RubbleProps {
	engine: HaulerEngine;
	x: number;
	y: number;
}

/** Rock debris flung from the drop point on each delivery. */
const Rubble = ({ engine, x, y }: RubbleProps) => (
	<Group>
		{Array.from({ length: RUBBLE_COUNT }, (_, i) => (
			<RubbleParticle key={`r${i}`} index={i} engine={engine} x={x} y={y} />
		))}
	</Group>
);

interface RubbleParticleProps {
	index: number;
	engine: HaulerEngine;
	x: number;
	y: number;
}

const RubbleParticle = ({ index, engine, x, y }: RubbleParticleProps) => {
	const dir = scatter(index, 3);
	const up = 0.5 + Math.abs(scatter(index, 4)) * 0.8;
	const r = 2 + Math.abs(scatter(index, 5)) * 4;
	const cx = useDerivedValue(() => {
		const p = Math.min(1, Math.max(0, (engine.nowMs.value - engine.deliverAt.value) / RUBBLE_LIFE_MS));
		return x + dir * 80 * p;
	});
	const cy = useDerivedValue(() => {
		const p = Math.min(1, Math.max(0, (engine.nowMs.value - engine.deliverAt.value) / RUBBLE_LIFE_MS));
		return y - up * 90 * p + 170 * p * p;
	});
	const opacity = useDerivedValue(() => {
		const p = (engine.nowMs.value - engine.deliverAt.value) / RUBBLE_LIFE_MS;
		return p < 0 || p > 1 ? 0 : 1 - p;
	});
	return <Circle cx={cx} cy={cy} r={r} color="#6B6B76" opacity={opacity} />;
};

// ---------------------------------------------------------------------------
// HUD helpers
// ---------------------------------------------------------------------------

interface GaugeFillProps {
	x: number;
	topY: number;
	gaugeH: number;
	shown: SharedValue<number>;
}

const GaugeFill = ({ x, topY, gaugeH, shown }: GaugeFillProps) => {
	const y = useDerivedValue(() => topY + gaugeH * (1 - Math.min(1, shown.value)));
	const height = useDerivedValue(() => gaugeH * Math.min(1, shown.value));
	return <RoundedRect x={x - 4} y={y} width={8} height={height} r={4} color={C.gaugeFill} />;
};

interface BannerTextProps {
	W: number;
	H: number;
	font: SkFont;
	text: SharedValue<string>;
}

const BannerText = ({ W, H, font, text }: BannerTextProps) => {
	const x = useDerivedValue(() => W / 2 - font.measureText(text.value).width / 2);
	return <SkiaText x={x} y={H * 0.28} text={text} font={font} color={C.bannerText} />;
};

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#161A22',
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
