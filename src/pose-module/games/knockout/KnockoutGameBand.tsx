import React, { useMemo } from 'react';
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

import { BOSS_ROSTER } from './bosses';
import { comboMultiplier } from './combat';
import { KNOCKOUT_COLORS, KNOCKOUT_TIMING } from './knockoutConfig';
import { BOSS_PHASE, type KnockoutEngine } from './useKnockoutEngine';

const C = KNOCKOUT_COLORS;
const T = KNOCKOUT_TIMING;
const OFFSCREEN = -9999;
const FONT_SMALL = 14;
const FONT_HUD = 20;
const FONT_POP = 24;
const FONT_BANNER = 56;

interface KnockoutGameBandProps {
	engine: KnockoutEngine;
}

interface PopupProps {
	engine: KnockoutEngine;
	slot: 0 | 1 | 2;
	font: ReturnType<typeof useFont>;
}

/** One pooled floating damage number above the boss. */
const DamagePopup = ({ engine, slot, font }: PopupProps) => {
	const tSV = slot === 0 ? engine.popupT0 : slot === 1 ? engine.popupT1 : engine.popupT2;
	const valSV = slot === 0 ? engine.popupVal0 : slot === 1 ? engine.popupVal1 : engine.popupVal2;

	const text = useDerivedValue(() => (tSV.value < 0 ? '' : `-${valSV.value}`));
	const x = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		if (!geom || tSV.value < 0) return OFFSCREEN;
		return geom.bossX - geom.bossR - 10 + slot * 24;
	});
	const y = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		if (!geom || tSV.value < 0) return 0;
		return geom.floorY - geom.bossR * 2.3 - tSV.value * 48;
	});
	const opacity = useDerivedValue(() => (tSV.value < 0 ? 0 : 1 - tSV.value));
	const color = useDerivedValue(() => (valSV.value >= 40 ? C.popupCrit : C.popup));

	if (!font) return null;
	return (
		<Group opacity={opacity}>
			<SkiaText x={x} y={y} text={text} font={font} color={color} />
		</Group>
	);
};

/**
 * The Push Knockout arena: hero vs boss on a flat-color stage. Every animated
 * prop is a derived value off the engine's shared state — zero React
 * re-renders during the fight. Boss silhouettes are parametric flat shapes
 * (crown/horns/wings toggled per roster entry), so a new boss costs data,
 * not assets.
 */
export const KnockoutGameBand = React.memo(({ engine }: KnockoutGameBandProps) => {
	const { t } = useTranslation(['settings']);
	const fontSmall = useFont(interSemiBold, FONT_SMALL);
	const fontHud = useFont(interSemiBold, FONT_HUD);
	const fontPop = useFont(interSemiBold, FONT_POP);
	const fontBanner = useFont(interSemiBold, FONT_BANNER);

	const bossNames = useMemo(
		() => BOSS_ROSTER.map(spec => t(`settings:aiTrainer.games.knockout.bosses.${spec.nameKey}`)),
		[t],
	);
	const fightText = t('settings:aiTrainer.games.knockout.fight');
	const dodgedText = t('settings:aiTrainer.games.knockout.dodged');

	const bandW = useDerivedValue(() => engine.geomSV.value?.bandW ?? 0);
	const bandH = useDerivedValue(() => engine.geomSV.value?.bandH ?? 0);
	const floorTop = useDerivedValue(() => engine.geomSV.value?.floorY ?? 0);
	const floorH = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		return geom ? geom.bandH - geom.floorY : 0;
	});

	const rosterIdx = useDerivedValue(() => engine.bossIndex.value % BOSS_ROSTER.length);
	const skyColor = useDerivedValue(() => BOSS_ROSTER[rosterIdx.value].sky);
	const floorColor = useDerivedValue(() => BOSS_ROSTER[rosterIdx.value].floor);
	const bossBody = useDerivedValue(() => BOSS_ROSTER[rosterIdx.value].body);
	const bossDark = useDerivedValue(() => BOSS_ROSTER[rosterIdx.value].bodyDark);
	const bossBelly = useDerivedValue(() => BOSS_ROSTER[rosterIdx.value].belly);

	// --- Fighters shake together after the athlete takes a hit ---
	const shakeTransform = useDerivedValue(() => {
		const s = engine.shakeT.value;
		return [{ translateX: Math.sin(s * 34) * 9 * s }, { translateY: Math.cos(s * 27) * 5 * s }];
	});

	// --- Hero: lunges on a punch, squashes with the athlete's own position ---
	const heroTransform = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		if (!geom) return [{ translateX: OFFSCREEN }];
		const x = geom.heroX + engine.punchT.value * geom.lungeDist;
		const crouch = (1 - engine.smoothedPos.value) * 0.22;
		return [{ translateX: x }, { translateY: geom.floorY }, { scaleY: 1 - crouch }];
	});
	const heroR = useDerivedValue(() => engine.geomSV.value?.heroR ?? 0);
	const heroBodyX = useDerivedValue(() => -heroR.value * 0.7);
	const heroBodyY = useDerivedValue(() => -heroR.value * 1.9);
	const heroBodyW = useDerivedValue(() => heroR.value * 1.4);
	const heroBodyH = useDerivedValue(() => heroR.value * 1.9);
	const heroBodyRad = useDerivedValue(() => heroR.value * 0.5);
	const heroBellyX = useDerivedValue(() => -heroR.value * 0.42);
	const heroBellyY = useDerivedValue(() => -heroR.value * 1.2);
	const heroBellyW = useDerivedValue(() => heroR.value * 0.84);
	const heroBellyH = useDerivedValue(() => heroR.value * 1.05);
	const heroHeadY = useDerivedValue(() => -heroR.value * 2.35);
	const heroHeadR = useDerivedValue(() => heroR.value * 0.62);
	const heroEyeX = useDerivedValue(() => heroR.value * 0.26);
	const heroEyeY = useDerivedValue(() => -heroR.value * 2.42);
	const heroEyeR = useDerivedValue(() => heroR.value * 0.15);
	const gloveX = useDerivedValue(() => heroR.value * (1.05 + engine.punchT.value * 0.9));
	const gloveY = useDerivedValue(() => -heroR.value * 1.45);
	const gloveR = useDerivedValue(() => heroR.value * 0.52);
	const gloveShineX = useDerivedValue(() => gloveX.value + gloveR.value * 0.25);
	const gloveShineY = useDerivedValue(() => gloveY.value - gloveR.value * 0.28);
	const gloveShineR = useDerivedValue(() => gloveR.value * 0.2);

	// --- Boss: enter / idle-bob / telegraph-grow / strike-lunge / dying-fall ---
	const bossTransform = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		if (!geom) return [{ translateX: OFFSCREEN }];
		const p = engine.bossPhase.value;
		const pt = engine.phaseT.value;
		let x = geom.bossX;
		let y = geom.floorY;
		let scale = 1;
		if (p === BOSS_PHASE.ENTERING) {
			const prog = Math.min(1, pt / T.ENTER_MS);
			x += (1 - prog) * (geom.bandW - geom.bossX + geom.bossR * 2.5);
		} else if (p === BOSS_PHASE.IDLE) {
			scale = 1 + 0.025 * Math.sin(pt / 260);
		} else if (p === BOSS_PHASE.TELEGRAPH) {
			const prog = Math.min(1, pt / T.TELEGRAPH_MS);
			x += geom.bossR * 0.25 * prog;
			scale = 1 + 0.16 * prog + 0.03 * Math.sin(pt / 60);
		} else if (p === BOSS_PHASE.STRIKE) {
			const prog = Math.min(1, pt / T.STRIKE_MS);
			x -= Math.sin(prog * Math.PI) * geom.strikeDist;
		} else if (p === BOSS_PHASE.DYING) {
			const prog = Math.min(1, pt / T.DYING_MS);
			y += prog * geom.bossR * 0.9;
			scale = 1 - 0.25 * prog;
		}
		x += engine.impactT.value * geom.bossR * 0.18;
		return [{ translateX: x }, { translateY: y }, { scale }];
	});
	const bossOpacity = useDerivedValue(() => {
		if (engine.bossPhase.value !== BOSS_PHASE.DYING) return 1;
		return Math.max(0, 1 - engine.phaseT.value / T.DYING_MS);
	});
	const bossR = useDerivedValue(() => engine.geomSV.value?.bossR ?? 0);
	const bossBodyX = useDerivedValue(() => -bossR.value);
	const bossBodyY = useDerivedValue(() => -bossR.value * 2);
	const bossBodyW = useDerivedValue(() => bossR.value * 2);
	const bossBodyH = useDerivedValue(() => bossR.value * 2);
	const bossBodyRad = useDerivedValue(
		() => bossR.value * (0.25 + 0.7 * BOSS_ROSTER[rosterIdx.value].roundness),
	);
	const bossBellyX = useDerivedValue(() => -bossR.value * 0.55);
	const bossBellyY = useDerivedValue(() => -bossR.value * 1.15);
	const bossBellyW = useDerivedValue(() => bossR.value * 1.1);
	const bossBellyH = useDerivedValue(() => bossR.value * 1.0);
	const bossBellyRad = useDerivedValue(() => bossBodyRad.value * 0.6);
	const bossEyeLX = useDerivedValue(() => -bossR.value * 0.45);
	const bossEyeRX = useDerivedValue(() => bossR.value * 0.15);
	const bossEyeY = useDerivedValue(() => -bossR.value * 1.55);
	const bossEyeR = useDerivedValue(() => bossR.value * 0.2);
	const bossPupilLX = useDerivedValue(() => bossEyeLX.value - bossEyeR.value * 0.35);
	const bossPupilRX = useDerivedValue(() => bossEyeRX.value - bossEyeR.value * 0.35);
	const bossPupilR = useDerivedValue(() => bossEyeR.value * 0.45);
	const mouthX = useDerivedValue(() => -bossR.value * 0.35);
	const mouthY = useDerivedValue(() => -bossR.value * 1.05);
	const mouthW = useDerivedValue(() => bossR.value * 0.6);
	const mouthH = useDerivedValue(() => bossR.value * 0.16);
	const hornsPath = useDerivedValue(() => {
		const p = Skia.Path.Make();
		const r = bossR.value;
		if (r === 0) return p;
		p.moveTo(-r * 0.75, -r * 1.95);
		p.lineTo(-r * 0.95, -r * 2.6);
		p.lineTo(-r * 0.4, -r * 2.05);
		p.close();
		p.moveTo(r * 0.45, -r * 2.05);
		p.lineTo(r * 0.65, -r * 2.6);
		p.lineTo(r * 0.05, -r * 1.95);
		p.close();
		return p;
	});
	const hornsOpacity = useDerivedValue(() => (BOSS_ROSTER[rosterIdx.value].hasHorns ? 1 : 0));
	const crownPath = useDerivedValue(() => {
		const p = Skia.Path.Make();
		const r = bossR.value;
		if (r === 0) return p;
		p.moveTo(-r * 0.5, -r * 2);
		p.lineTo(-r * 0.5, -r * 2.45);
		p.lineTo(-r * 0.25, -r * 2.15);
		p.lineTo(0, -r * 2.5);
		p.lineTo(r * 0.25, -r * 2.15);
		p.lineTo(r * 0.5, -r * 2.45);
		p.lineTo(r * 0.5, -r * 2);
		p.close();
		return p;
	});
	const crownOpacity = useDerivedValue(() => (BOSS_ROSTER[rosterIdx.value].hasCrown ? 1 : 0));
	const wingsPath = useDerivedValue(() => {
		const p = Skia.Path.Make();
		const r = bossR.value;
		if (r === 0) return p;
		p.moveTo(-r * 0.9, -r * 1.6);
		p.quadTo(-r * 1.9, -r * 2.4, -r * 1.6, -r * 0.9);
		p.close();
		p.moveTo(r * 0.9, -r * 1.6);
		p.quadTo(r * 1.9, -r * 2.4, r * 1.6, -r * 0.9);
		p.close();
		return p;
	});
	const wingsOpacity = useDerivedValue(() => (BOSS_ROSTER[rosterIdx.value].hasWings ? 1 : 0));
	const bossFlashOpacity = useDerivedValue(() => engine.impactT.value * 0.55);

	// --- Impact star at the glove contact point ---
	const starPath = useDerivedValue(() => {
		const p = Skia.Path.Make();
		const geom = engine.geomSV.value;
		if (!geom) return p;
		const r = geom.bossR * 0.55;
		for (let i = 0; i < 8; i += 1) {
			const angle = (i * Math.PI) / 4;
			const outer = i % 2 === 0 ? r : r * 0.45;
			const px = Math.cos(angle) * outer;
			const py = Math.sin(angle) * outer;
			if (i === 0) p.moveTo(px, py);
			else p.lineTo(px, py);
		}
		p.close();
		return p;
	});
	const starTransform = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		if (!geom) return [{ translateX: OFFSCREEN }];
		return [
			{ translateX: geom.bossX - geom.bossR * 1.05 },
			{ translateY: geom.floorY - geom.bossR * 1.3 },
			{ scale: 0.5 + engine.impactT.value * 0.7 },
		];
	});
	const starOpacity = useDerivedValue(() => engine.impactT.value);

	// --- Warning "!" during the telegraph ---
	const warningTransform = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		if (!geom) return [{ translateX: OFFSCREEN }];
		const pulse = 1 + 0.2 * Math.sin(engine.phaseT.value / 90);
		return [
			{ translateX: geom.bossX },
			{ translateY: geom.floorY - geom.bossR * 2.9 },
			{ scale: pulse },
		];
	});
	const warningOpacity = useDerivedValue(() =>
		engine.bossPhase.value === BOSS_PHASE.TELEGRAPH ? 1 : 0,
	);

	// --- HUD: boss HP bar + name, hearts, combo, score, popups, banners ---
	const hpBarW = useDerivedValue(() => bandW.value * 0.52);
	const hpFillW = useDerivedValue(() => {
		const max = engine.bossMaxHp.value;
		return max > 0 ? (engine.bossHp.value / max) * hpBarW.value : 0;
	});
	const hpColor = useDerivedValue(() =>
		engine.bossHp.value / Math.max(1, engine.bossMaxHp.value) < 0.3 ? C.hpLow : C.hpFill,
	);
	const bossNameText = useDerivedValue(() => bossNames[rosterIdx.value]);

	const heartPath = useDerivedValue(() => {
		const p = Skia.Path.Make();
		p.addCircle(-3.4, 0, 4.8);
		p.addCircle(3.4, 0, 4.8);
		p.moveTo(-7.7, 1.9);
		p.lineTo(7.7, 1.9);
		p.lineTo(0, 12.5);
		p.close();
		return p;
	});
	const heart0Transform = useDerivedValue(() => [{ translateX: bandW.value - 26 }, { translateY: 64 }]);
	const heart1Transform = useDerivedValue(() => [{ translateX: bandW.value - 52 }, { translateY: 64 }]);
	const heart2Transform = useDerivedValue(() => [{ translateX: bandW.value - 78 }, { translateY: 64 }]);
	const heart0Color = useDerivedValue(() => (engine.hearts.value > 0 ? C.heart : C.heartLost));
	const heart1Color = useDerivedValue(() => (engine.hearts.value > 1 ? C.heart : C.heartLost));
	const heart2Color = useDerivedValue(() => (engine.hearts.value > 2 ? C.heart : C.heartLost));

	const comboText = useDerivedValue(() => `x${comboMultiplier(engine.comboChain.value)}`);
	const comboOpacity = useDerivedValue(() => (engine.comboChain.value >= 2 ? 1 : 0));
	const comboX = useDerivedValue(() => (engine.geomSV.value?.heroX ?? 0) - 18);
	const comboY = useDerivedValue(() => {
		const geom = engine.geomSV.value;
		return geom ? geom.floorY - geom.heroR * 3.5 : 0;
	});
	const meterX = useDerivedValue(() => (engine.geomSV.value?.heroX ?? 0) - 32);
	const meterY = useDerivedValue(() => comboY.value + 8);
	const meterFillW = useDerivedValue(() => 64 * engine.comboMeter.value);

	const scoreText = useDerivedValue(() => `${engine.score.value}`);
	const scorePillX = useDerivedValue(() => bandW.value - 84 );
	const scoreTextX = useDerivedValue(() => {
		const digits = `${engine.score.value}`.length;
		return bandW.value - 48 - (digits - 1) * (FONT_HUD * 0.3);
	});

	const fightOpacity = useDerivedValue(() => engine.fightT.value);
	const fightX = useDerivedValue(() => {
		if (!fontBanner) return 0;
		return bandW.value / 2 - fontBanner.measureText(fightText).width / 2;
	});
	const bannerY = useDerivedValue(() => bandH.value / 2 + FONT_BANNER * 0.36);

	const dodgedOpacity = useDerivedValue(() => engine.dodgeT.value);
	const dodgedTransform = useDerivedValue(() => {
		if (!fontBanner) return [{ translateX: OFFSCREEN }];
		const w = fontBanner.measureText(dodgedText).width * 0.65;
		return [
			{ translateX: bandW.value / 2 - w / 2 },
			{ translateY: bandH.value * 0.32 },
			{ scale: 0.65 },
		];
	});

	const warningX = useDerivedValue(() => {
		if (!fontBanner) return 0;
		return -fontBanner.measureText('!').width / 2;
	});

	const flashOpacity = useDerivedValue(() => engine.hitFlash.value * 0.3);

	const pausedStyle = useAnimatedStyle(() => ({
		opacity: withTiming(engine.paused.value ? 1 : 0, { duration: 200 }),
	}));
	const calibrateStyle = useAnimatedStyle(() => ({
		opacity: withTiming(engine.running.value && engine.awaitingRep.value ? 1 : 0, { duration: 200 }),
	}));

	return (
		<View style={styles.root}>
			<Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
				<Rect x={0} y={0} width={bandW} height={bandH} color={skyColor} />
				<Rect x={0} y={floorTop} width={bandW} height={floorH} color={floorColor} />
				<Group transform={shakeTransform}>
					<Group transform={bossTransform} opacity={bossOpacity}>
						<Path path={wingsPath} color={bossDark} opacity={wingsOpacity} />
						<RoundedRect x={bossBodyX} y={bossBodyY} width={bossBodyW} height={bossBodyH} r={bossBodyRad} color={bossBody} />
						<RoundedRect x={bossBellyX} y={bossBellyY} width={bossBellyW} height={bossBellyH} r={bossBellyRad} color={bossBelly} />
						<Path path={hornsPath} color={bossDark} opacity={hornsOpacity} />
						<Path path={crownPath} color="#FFD34D" opacity={crownOpacity} />
						<Circle cx={bossEyeLX} cy={bossEyeY} r={bossEyeR} color={C.eyeWhite} />
						<Circle cx={bossEyeRX} cy={bossEyeY} r={bossEyeR} color={C.eyeWhite} />
						<Circle cx={bossPupilLX} cy={bossEyeY} r={bossPupilR} color={C.eyePupil} />
						<Circle cx={bossPupilRX} cy={bossEyeY} r={bossPupilR} color={C.eyePupil} />
						<RoundedRect x={mouthX} y={mouthY} width={mouthW} height={mouthH} r={4} color={C.eyePupil} />
						<RoundedRect x={bossBodyX} y={bossBodyY} width={bossBodyW} height={bossBodyH} r={bossBodyRad} color="#FFFFFF" opacity={bossFlashOpacity} />
					</Group>
					<Group transform={heroTransform}>
						<RoundedRect x={heroBodyX} y={heroBodyY} width={heroBodyW} height={heroBodyH} r={heroBodyRad} color={C.hero} />
						<RoundedRect x={heroBellyX} y={heroBellyY} width={heroBellyW} height={heroBellyH} r={heroBodyRad} color={C.heroBelly} />
						<Circle cx={0} cy={heroHeadY} r={heroHeadR} color={C.hero} />
						<Circle cx={heroEyeX} cy={heroEyeY} r={heroEyeR} color={C.eyePupil} />
						<Circle cx={gloveX} cy={gloveY} r={gloveR} color={C.glove} />
						<Circle cx={gloveShineX} cy={gloveShineY} r={gloveShineR} color={C.gloveShine} />
					</Group>
					<Group transform={starTransform} opacity={starOpacity}>
						<Path path={starPath} color={C.impactStar} />
					</Group>
				</Group>
				{fontBanner && (
					<Group transform={warningTransform} opacity={warningOpacity}>
						<SkiaText x={warningX} y={0} text="!" font={fontBanner} color={C.warning} />
					</Group>
				)}
				<Rect x={0} y={0} width={bandW} height={bandH} color={C.flash} opacity={flashOpacity} />
				<RoundedRect x={16} y={14} width={hpBarW} height={16} r={8} color={C.hpBack} />
				<RoundedRect x={16} y={14} width={hpFillW} height={16} r={8} color={hpColor} />
				{fontSmall && <SkiaText x={16} y={48} text={bossNameText} font={fontSmall} color={C.bannerText} />}
				<Path path={heartPath} color={heart0Color} transform={heart0Transform} />
				<Path path={heartPath} color={heart1Color} transform={heart1Transform} />
				<Path path={heartPath} color={heart2Color} transform={heart2Transform} />
				<RoundedRect x={scorePillX} y={12} width={68} height={34} r={17} color={C.scorePill} />
				{fontHud && <SkiaText x={scoreTextX} y={36} text={scoreText} font={fontHud} color={C.scoreText} />}
				{fontPop && (
					<Group opacity={comboOpacity}>
						<SkiaText x={comboX} y={comboY} text={comboText} font={fontPop} color={C.comboText} />
						<RoundedRect x={meterX} y={meterY} width={64} height={6} r={3} color={C.comboMeterBack} />
						<RoundedRect x={meterX} y={meterY} width={meterFillW} height={6} r={3} color={C.comboMeter} />
					</Group>
				)}
				<DamagePopup engine={engine} slot={0} font={fontPop} />
				<DamagePopup engine={engine} slot={1} font={fontPop} />
				<DamagePopup engine={engine} slot={2} font={fontPop} />
				{fontBanner && (
					<Group opacity={fightOpacity}>
						<SkiaText x={fightX} y={bannerY} text={fightText} font={fontBanner} color={C.bannerText} />
					</Group>
				)}
				{fontBanner && (
					<Group transform={dodgedTransform} opacity={dodgedOpacity}>
						<SkiaText x={0} y={0} text={dodgedText} font={fontBanner} color={C.dodged} />
					</Group>
				)}
			</Canvas>
			<Animated.View style={[styles.hintOverlay, calibrateStyle]} pointerEvents="none">
				<Text style={styles.hintText}>{t('settings:aiTrainer.games.knockout.calibrate')}</Text>
			</Animated.View>
			<Animated.View style={[styles.pausedOverlay, pausedStyle]} pointerEvents="none">
				<Text style={styles.pausedText}>{t('settings:aiTrainer.games.stepBack')}</Text>
			</Animated.View>
		</View>
	);
});

KnockoutGameBand.displayName = 'KnockoutGameBand';

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#3A2E5C',
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
