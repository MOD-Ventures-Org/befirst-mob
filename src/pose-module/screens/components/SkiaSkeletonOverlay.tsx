import { StyleSheet } from 'react-native';
import { Canvas, Circle, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import { type SharedValue, useDerivedValue } from 'react-native-reanimated';

import { PUSHUP_PARAMS } from '@/src/pose-module/exercises/pushup.config';
import { USE_LIGHTWEIGHT_ANDROID_OVERLAY } from '@/src/pose-module/performanceProfile';
import { BRAND_ORANGE } from '@/src/pose-module/pyramid/pyramid';
import { FULL_BONES, RENDER_POINTS } from '@/src/pose-module/skeleton';
import type { RenderPose } from '@/src/pose-module/types';

// Line color split into RGB so per-endpoint alpha can be applied (segments
// fade solid-near-the-body → transparent-toward-the-extremity).
const LINE_RGB = '255, 255, 255'; // #FFFFFF
// Debug glow for uncertain joints/segments: soft yellow, deliberately subtle —
// a QA aid, not an alarm.
const GLOW_RGB = '250, 204, 21'; // #FACC15

const TRANSPARENT_PAIR = ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'];

// Static adjacency: for each render point, the partner point of every bone it
// participates in — a dot is drawn only while at least one of its bones is.
const BONE_PARTNERS: number[][] = RENDER_POINTS.map((_, idx) =>
	FULL_BONES.filter(([a, b]) => a === idx || b === idx).map(([a, b]) => (a === idx ? b : a)),
);

interface BoneLineProps {
	pose: SharedValue<RenderPose | null>;
	aIdx: number;
	bIdx: number;
	withGlow: boolean;
}

// One skeleton segment. All per-frame values are derived on the UI thread from
// the pose shared value — the component itself never re-renders per frame.
const BoneLine = ({ pose, aIdx, bIdx, withGlow }: BoneLineProps) => {
	const path = useDerivedValue(() => {
		const skPath = Skia.Path.Make();
		const p = pose.value;
		const a = p?.pts[aIdx];
		const b = p?.pts[bIdx];
		if (!a || !b || !a.show || !b.show) return skPath;
		skPath.moveTo(a.x, a.y);
		skPath.lineTo(b.x, b.y);
		return skPath;
	});

	const start = useDerivedValue(() => {
		const a = pose.value?.pts[aIdx];
		return vec(a?.x ?? 0, a?.y ?? 0);
	});

	const end = useDerivedValue(() => {
		const b = pose.value?.pts[bIdx];
		return vec(b?.x ?? 0, b?.y ?? 0);
	});

	const colors = useDerivedValue(() => {
		const p = pose.value;
		const a = p?.pts[aIdx];
		const b = p?.pts[bIdx];
		if (!a || !b || !a.show || !b.show) return TRANSPARENT_PAIR;
		return [`rgba(${LINE_RGB}, ${a.alpha.toFixed(3)})`, `rgba(${LINE_RGB}, ${b.alpha.toFixed(3)})`];
	});

	// Glow strength follows the uncertain end and fades toward the certain one,
	// so a whole limb never lights up for one bad joint.
	const glowColors = useDerivedValue(() => {
		const p = pose.value;
		const a = p?.pts[aIdx];
		const b = p?.pts[bIdx];
		if (!a || !b || !a.show || !b.show || (!a.uncertain && !b.uncertain)) return TRANSPARENT_PAIR;
		const ga = a.uncertain ? PUSHUP_PARAMS.GLOW_ALPHA * a.alpha : 0;
		const gb = b.uncertain ? PUSHUP_PARAMS.GLOW_ALPHA * b.alpha : 0;
		return [`rgba(${GLOW_RGB}, ${ga.toFixed(3)})`, `rgba(${GLOW_RGB}, ${gb.toFixed(3)})`];
	});

	return (
		<>
			{withGlow && (
				<Path path={path} style="stroke" strokeWidth={10} strokeCap="round" strokeJoin="round">
					<LinearGradient start={start} end={end} colors={glowColors} />
				</Path>
			)}
			<Path path={path} style="stroke" strokeWidth={4} strokeCap="round" strokeJoin="round">
				<LinearGradient start={start} end={end} colors={colors} />
			</Path>
		</>
	);
};

interface JointDotProps {
	pose: SharedValue<RenderPose | null>;
	idx: number;
}

const JointDot = ({ pose, idx }: JointDotProps) => {
	const c = useDerivedValue(() => {
		const pt = pose.value?.pts[idx];
		return vec(pt?.x ?? 0, pt?.y ?? 0);
	});

	const opacity = useDerivedValue(() => {
		const p = pose.value;
		const pt = p?.pts[idx];
		if (!p || !pt || !pt.show) return 0;
		const partners = BONE_PARTNERS[idx];
		for (let i = 0; i < partners.length; i++) {
			if (p.pts[partners[i]]?.show) return pt.alpha;
		}
		return 0;
	});

	// Neutral joints: per-joint pass/fail coloring is removed until form
	// highlights are designed for the head-on camera.
	return (
		<>
			<Circle c={c} r={6} opacity={opacity} color="white" />
			<Circle c={c} r={6} opacity={opacity} style="stroke" strokeWidth={4} color={BRAND_ORANGE} />
		</>
	);
};

interface SkiaSkeletonOverlayProps {
	// Latest pose to draw, written from the JS pipeline; read on the UI thread so
	// the skeleton never goes through React state per frame (spec §11.1).
	pose: SharedValue<RenderPose | null>;
}

const DetailedSkeletonOverlay = ({ pose }: SkiaSkeletonOverlayProps) => {
	const withGlow = PUSHUP_PARAMS.DEBUG_UNCERTAIN_GLOW;

	return (
		<Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
			{FULL_BONES.map(([aIdx, bIdx], i) => (
				<BoneLine key={i} pose={pose} aIdx={aIdx} bIdx={bIdx} withGlow={withGlow} />
			))}
			{RENDER_POINTS.map((_, idx) => (
				<JointDot key={idx} pose={pose} idx={idx} />
			))}
		</Canvas>
	);
};

// MediaPipe updates pose state independently of the display refresh rate. On
// Android, one batched path is used for bones and one for joints. The orange
// joint outline is deliberately omitted here to keep the camera and skeleton
// within the UI budget on mid-range phones; the tracking pipeline is unchanged.
const LightweightAndroidSkeletonOverlay = ({ pose }: SkiaSkeletonOverlayProps) => {
	const skeletonPath = useDerivedValue(() => {
		const path = Skia.Path.Make();
		const currentPose = pose.value;
		if (!currentPose) return path;

		for (const [aIdx, bIdx] of FULL_BONES) {
			const a = currentPose.pts[aIdx];
			const b = currentPose.pts[bIdx];
			if (!a || !b || !a.show || !b.show) continue;
			path.moveTo(a.x, a.y);
			path.lineTo(b.x, b.y);
		}
		return path;
	});

	const jointPath = useDerivedValue(() => {
		const path = Skia.Path.Make();
		const currentPose = pose.value;
		if (!currentPose) return path;

		for (let idx = 0; idx < RENDER_POINTS.length; idx += 1) {
			const point = currentPose.pts[idx];
			if (!point?.show) continue;

			const hasVisiblePartner = BONE_PARTNERS[idx].some(partner => currentPose.pts[partner]?.show);
			if (hasVisiblePartner) path.addCircle(point.x, point.y, 6);
		}
		return path;
	});

	const opacity = useDerivedValue(() => {
		const currentPose = pose.value;
		if (!currentPose) return 0;

		let maxAlpha = 0;
		for (const point of currentPose.pts) {
			if (point.show && point.alpha > maxAlpha) maxAlpha = point.alpha;
		}
		return maxAlpha;
	});

	return (
		<Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
			<Path path={skeletonPath} style="stroke" strokeWidth={4} strokeCap="round" strokeJoin="round" color="white" opacity={opacity} />
			<Path path={jointPath} color="white" opacity={opacity} />
		</Canvas>
	);
};

const SkiaSkeletonOverlay = (props: SkiaSkeletonOverlayProps) =>
	USE_LIGHTWEIGHT_ANDROID_OVERLAY ? <LightweightAndroidSkeletonOverlay {...props} /> : <DetailedSkeletonOverlay {...props} />;

export default SkiaSkeletonOverlay;
