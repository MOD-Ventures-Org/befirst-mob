import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { useVideoPlayer, VideoView } from 'expo-video';

import { usePoseSession } from '../../hooks/usePoseSession';
import type { BandedSideStepTrackingState, SideStepMeasurement } from '../../side-steps/BandedSideStepDetector';
import type { SquatTrackingState } from '../../squats/SquatDetector';
import SkiaSkeletonOverlay from './SkiaSkeletonOverlay';

export type ReplayExercise = 'pushup-pyramid' | 'squat' | 'jump-squat' | 'banded-side-step';

// Keep this in sync with App.tsx. Set to true when Jump Squats are ready to
// be exposed again.
const SHOW_JUMP_SQUATS = true;

// Twenty analysed frames per second preserves the short airborne arc of quick
// professional jumps while remaining practical for an offline developer run.
const REPLAY_SAMPLE_INTERVAL_MS = 50;
const MAX_REPLAY_DURATION_MS = 60_000;

const EXERCISES: Array<{ id: ReplayExercise; label: string }> = [
	{ id: 'pushup-pyramid', label: 'Push-ups' },
	{ id: 'squat', label: 'Squats' },
	...(SHOW_JUMP_SQUATS ? [{ id: 'jump-squat' as const, label: 'Jump Squats' }] : []),
	{ id: 'banded-side-step', label: 'Side Steps' },
];

interface VideoReplayTrackerProps {
	initialExercise: ReplayExercise;
	onClose: () => void;
}

interface ReplayRunProps {
	asset: ImagePicker.ImagePickerAsset;
	exercise: ReplayExercise;
	onChooseAnother: () => void;
	onClose: () => void;
}

function exerciseLabel(exercise: ReplayExercise): string {
	return EXERCISES.find(option => option.id === exercise)?.label ?? 'Exercise';
}

function formatReplayTime(milliseconds: number): string {
	const seconds = Math.max(0, milliseconds) / 1000;
	return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

function lowerBreakdown(
	exercise: ReplayExercise,
	squatTracking: SquatTrackingState,
	sideStepTracking: BandedSideStepTrackingState,
): string | null {
	if (exercise === 'jump-squat') return `Jump ${squatTracking.repCounts.jump}`;
	if (exercise === 'squat') return `Standard ${squatTracking.repCounts.standard} · Pulse ${squatTracking.repCounts.pulse}`;
	if (exercise === 'banded-side-step') return `Left ${sideStepTracking.leftSteps} · Right ${sideStepTracking.rightSteps}`;
	return null;
}

function jumpSignalSummary(squatTracking: SquatTrackingState): string | null {
	const diagnostics = squatTracking.jumpDiagnostics;
	if (!diagnostics) return null;
	const signal = (value: number | null) => (value === null ? '—' : value.toFixed(2));
	return `${diagnostics.state.toUpperCase()} · feet ${signal(diagnostics.leftFootRiseSW)} / ${signal(diagnostics.rightFootRiseSW)} · hip ${signal(diagnostics.pelvisRiseSW)}`;
}

function compactStepDistance(step: SideStepMeasurement): string {
	const direction = step.direction === 'left' ? 'L' : 'R';
	const distance = step.estimatedDistanceCm === null ? `${step.distanceSW.toFixed(2)} SW` : `≈${Math.round(step.estimatedDistanceCm)} cm`;
	return `${direction}${step.id} ${distance}`;
}

function sideStepDistanceSummary(sideStepTracking: BandedSideStepTrackingState): string | null {
	const current = sideStepTracking.activeStep ?? sideStepTracking.lastStep;
	if (!current) return null;
	const state = sideStepTracking.activeStep ? 'CURRENT' : 'LAST';
	const direction = current.direction.toUpperCase();
	const primary = current.estimatedDistanceCm === null
		? `${current.distanceSW.toFixed(2)} shoulder widths`
		: `≈${Math.round(current.estimatedDistanceCm)} cm · ${current.distanceSW.toFixed(2)} SW`;
	const recent = sideStepTracking.stepHistory.slice(-5).map(compactStepDistance).join(' · ');
	return `${state} ${direction} · ${primary}\nAverage ${sideStepTracking.averageDistanceSW?.toFixed(2) ?? '—'} SW · Longest ${sideStepTracking.longestDistanceSW?.toFixed(2) ?? '—'} SW\n${recent}`;
}

function ReplayRun({ asset, exercise, onChooseAnother, onClose }: ReplayRunProps) {
	const player = useVideoPlayer(asset.uri, currentPlayer => {
		currentPlayer.muted = true;
		currentPlayer.loop = false;
	});
	const {
		pose,
		repCount,
		squatTracking,
		sideStepTracking,
		trackingDetail,
		initError,
		isRunning,
		start,
		stop,
		processReplayImage,
	} = usePoseSession({ exercise, debugTrace: true });
	const [viewport, setViewport] = useState({ width: 0, height: 0 });
	const [progressMs, setProgressMs] = useState(0);
	const [status, setStatus] = useState<'ready' | 'running' | 'complete' | 'error'>('ready');
	const [error, setError] = useState<string | null>(null);
	const replayToken = useRef(0);
	const lastProcessedMs = useRef(0);

	const durationMs = Math.round(asset.duration ?? 0);
	const breakdown = lowerBreakdown(exercise, squatTracking, sideStepTracking);
	const jumpSignals = exercise === 'jump-squat' ? jumpSignalSummary(squatTracking) : null;
	const sideStepDistances = exercise === 'banded-side-step' ? sideStepDistanceSummary(sideStepTracking) : null;

	useEffect(
		() => () => {
			replayToken.current += 1;
			player.pause();
		},
		[player],
	);

	const onLayout = useCallback((event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		setViewport({ width, height });
	}, []);

	const runReplay = useCallback(async () => {
		if (viewport.width < 2 || viewport.height < 2) return;
		if (durationMs <= 0) {
			setError('This video has no readable duration. Please choose a standard MP4 or MOV clip.');
			setStatus('error');
			return;
		}
		if (durationMs > MAX_REPLAY_DURATION_MS) {
			setError('Use a clip under 60 seconds so replay stays responsive.');
			setStatus('error');
			return;
		}

		const token = replayToken.current + 1;
		replayToken.current = token;
		lastProcessedMs.current = 0;
		setError(null);
		setProgressMs(0);
		setStatus('running');
		player.pause();
		player.currentTime = 0;
		start();

		try {
			for (let timestampMs = 0; timestampMs < durationMs; timestampMs += REPLAY_SAMPLE_INTERVAL_MS) {
				if (replayToken.current !== token) return;
				const thumbnail = await getThumbnailAsync(asset.uri, { time: timestampMs, quality: 0.9 });
				if (replayToken.current !== token) return;
				player.currentTime = timestampMs / 1000;
				await processReplayImage({
					imagePath: thumbnail.uri,
					timestampMs,
					displayWidth: viewport.width,
					displayHeight: viewport.height,
				});
				if (replayToken.current !== token) return;
				lastProcessedMs.current = timestampMs;
				setProgressMs(timestampMs);
			}

			if (replayToken.current !== token) return;
			player.currentTime = Math.max(0, durationMs - REPLAY_SAMPLE_INTERVAL_MS) / 1000;
			stop(durationMs);
			setProgressMs(durationMs);
			setStatus('complete');
		} catch (caught) {
			if (replayToken.current !== token) return;
			stop(lastProcessedMs.current);
			setError(caught instanceof Error ? caught.message : 'Unable to decode this video.');
			setStatus('error');
		}
	}, [asset.uri, durationMs, player, processReplayImage, start, stop, viewport.height, viewport.width]);

	const cancelReplay = useCallback(() => {
		replayToken.current += 1;
		player.pause();
		stop(lastProcessedMs.current);
		setStatus('ready');
	}, [player, stop]);

	return (
		<View style={styles.root} onLayout={onLayout}>
			<VideoView contentFit="contain" nativeControls={false} player={player} style={StyleSheet.absoluteFill} />
			<SkiaSkeletonOverlay pose={pose} />

			<View pointerEvents="box-none" style={styles.overlay}>
				<View style={styles.headerRow}>
					<Pressable accessibilityLabel="Close video replay" onPress={onClose} style={styles.closeButton}>
						<Text style={styles.closeButtonText}>×</Text>
					</Pressable>
					<View style={styles.replayPill}>
						<Text style={styles.replayPillText}>DEV VIDEO REPLAY</Text>
					</View>
				</View>

				<View pointerEvents="none" style={styles.resultCard}>
					<Text style={styles.exerciseLabel}>{exerciseLabel(exercise)}</Text>
					<Text style={styles.repCount}>{repCount}</Text>
					<Text style={styles.statusText}>
						{status === 'ready'
							? 'Choose Run replay to analyse this clip'
							: status === 'running'
								? `Analysing ${formatReplayTime(progressMs)} / ${formatReplayTime(durationMs)}`
								: status === 'complete'
									? `Replay complete · ${formatReplayTime(durationMs)}`
									: 'Replay could not finish'}
					</Text>
					{breakdown ? <Text style={styles.breakdown}>{breakdown}</Text> : null}
					{trackingDetail ? <Text style={styles.detail}>{trackingDetail}</Text> : null}
					{jumpSignals ? <Text style={styles.diagnostics}>{jumpSignals}</Text> : null}
					{sideStepDistances ? <Text style={styles.diagnostics}>{sideStepDistances}</Text> : null}
					{initError || error ? <Text style={styles.error}>{initError ?? error}</Text> : null}
				</View>

				<View style={styles.controls}>
					{status === 'running' ? (
						<Pressable onPress={cancelReplay} style={[styles.action, styles.cancelAction]}>
							<ActivityIndicator color="#fff" size="small" />
							<Text style={styles.actionText}>Cancel replay</Text>
						</Pressable>
					) : (
						<Pressable disabled={isRunning || viewport.width < 2} onPress={runReplay} style={[styles.action, isRunning && styles.actionDisabled]}>
							<Text style={styles.actionText}>{status === 'complete' ? 'Run again' : 'Run replay'}</Text>
						</Pressable>
					)}
					<Pressable disabled={status === 'running'} onPress={onChooseAnother} style={styles.secondaryAction}>
						<Text style={styles.secondaryActionText}>Choose another video</Text>
					</Pressable>
				</View>
			</View>
		</View>
	);
}

export default function VideoReplayTracker({ initialExercise, onClose }: VideoReplayTrackerProps) {
	const [exercise, setExercise] = useState<ReplayExercise>(initialExercise);
	const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
	const [pickerError, setPickerError] = useState<string | null>(null);

	const chooseVideo = useCallback(async () => {
		setPickerError(null);
		try {
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ['videos'],
				allowsMultipleSelection: false,
			});
			if (!result.canceled && result.assets[0]) setAsset(result.assets[0]);
		} catch (caught) {
			setPickerError(caught instanceof Error ? caught.message : 'Unable to open the video library.');
		}
	}, []);

	if (asset) {
		return <ReplayRun asset={asset} exercise={exercise} onChooseAnother={() => setAsset(null)} onClose={onClose} />;
	}

	return (
		<View style={styles.pickerRoot}>
		<Pressable accessibilityLabel="Close video replay" onPress={onClose} style={styles.pickerCloseButton}>
			<Text style={styles.closeButtonText}>×</Text>
		</Pressable>
		<View style={styles.pickerCard}>
			<Text style={styles.pickerEyebrow}>DEVELOPER TOOL</Text>
			<Text style={styles.pickerTitle}>Replay a test video</Text>
			<Text style={styles.pickerDetail}>
				The clip is analysed frame-by-frame with the same on-device pose model and exercise counter. Nothing is uploaded; temporary decoded frames are not kept by the app.
			</Text>

			<Text style={styles.exercisePickerLabel}>Exercise</Text>
			<View style={styles.exerciseButtons}>
				{EXERCISES.map(option => (
					<Pressable
						key={option.id}
						onPress={() => setExercise(option.id)}
						style={[styles.exerciseButton, exercise === option.id && styles.exerciseButtonSelected]}
					>
						<Text style={[styles.exerciseButtonText, exercise === option.id && styles.exerciseButtonTextSelected]}>
							{option.label}
						</Text>
					</Pressable>
				))}
			</View>

			<Pressable onPress={chooseVideo} style={styles.action}>
				<Text style={styles.actionText}>Choose a video</Text>
			</Pressable>
			<Text style={styles.limitText}>Use short clips—up to 60 seconds—for repeatable results.</Text>
			{pickerError ? <Text style={styles.error}>{pickerError}</Text> : null}
		</View>
	</View>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1, backgroundColor: '#050505' },
	overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', padding: 20, paddingTop: 58, paddingBottom: 34 },
	headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
	closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: 'rgba(9, 12, 18, 0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
	pickerCloseButton: { position: 'absolute', top: 58, left: 20, zIndex: 1, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)' },
	closeButtonText: { color: '#fff', fontSize: 34, fontWeight: '300', lineHeight: 38 },
	replayPill: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(248, 150, 30, 0.94)' },
	replayPillText: { color: '#171008', fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
	resultCard: { alignSelf: 'center', width: '90%', maxWidth: 390, marginTop: 18, padding: 18, borderRadius: 18, backgroundColor: 'rgba(8, 11, 17, 0.79)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center' },
	exerciseLabel: { color: '#d8dde7', fontSize: 13, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
	repCount: { marginTop: 2, color: '#fff', fontSize: 58, lineHeight: 65, fontWeight: '900' },
	statusText: { color: '#ffc17c', fontSize: 14, fontWeight: '700', textAlign: 'center' },
	breakdown: { marginTop: 8, color: '#fff', fontSize: 16, fontWeight: '800' },
	detail: { marginTop: 7, color: '#d5d9e1', fontSize: 13, lineHeight: 18, textAlign: 'center' },
	diagnostics: { marginTop: 7, color: '#8fa5c9', fontSize: 11, lineHeight: 16, textAlign: 'center' },
	error: { marginTop: 10, color: '#ff9393', fontSize: 13, lineHeight: 18, textAlign: 'center' },
	controls: { alignSelf: 'center', width: '90%', maxWidth: 390, gap: 10 },
	action: { minHeight: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, borderRadius: 14, backgroundColor: '#f8961e', paddingHorizontal: 18 },
	cancelAction: { backgroundColor: '#a84242' },
	actionDisabled: { opacity: 0.55 },
	actionText: { color: '#171008', fontSize: 16, fontWeight: '900' },
	secondaryAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(8, 11, 17, 0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
	secondaryActionText: { color: '#fff', fontSize: 14, fontWeight: '800' },
	pickerRoot: { flex: 1, justifyContent: 'center', padding: 22, backgroundColor: '#0a0d13' },
	pickerCard: { padding: 22, borderRadius: 22, backgroundColor: '#171b23', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
	pickerEyebrow: { color: '#ffc17c', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
	pickerTitle: { marginTop: 7, color: '#fff', fontSize: 28, fontWeight: '900' },
	pickerDetail: { marginTop: 10, color: '#cbd1dc', fontSize: 15, lineHeight: 21 },
	exercisePickerLabel: { marginTop: 22, color: '#fff', fontSize: 14, fontWeight: '800' },
	exerciseButtons: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
	exerciseButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
	exerciseButtonSelected: { backgroundColor: '#f8961e', borderColor: '#f8961e' },
	exerciseButtonText: { color: '#d8dde7', fontSize: 13, fontWeight: '800' },
	exerciseButtonTextSelected: { color: '#171008' },
	limitText: { marginTop: 12, color: '#aeb6c5', fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
