import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePoseSession, usePyramidSession } from './src/pose-module';
import { PUSHUP_PARAMS } from './src/pose-module/exercises/pushup.config';
import {
	BRAND_ORANGE,
	buildPyramidRows,
	PYRAMID_LEVEL_OPTIONS,
	type PyramidLevel,
} from './src/pose-module/pyramid/pyramid';
import type { PyramidPhase } from './src/pose-module/hooks/usePyramidSession';
import type { SideStepDirection } from './src/pose-module/side-steps/BandedSideStepDetector';
import type { SquatVariant } from './src/pose-module/squats/SquatDetector';
import { DebugPanel } from './src/pose-module/screens/components/DebugPanel';
import PermissionPlaceholder from './src/pose-module/screens/components/PermissionPlaceholder';
import PoseCamera from './src/pose-module/screens/components/PoseCamera';
import SkiaSkeletonOverlay from './src/pose-module/screens/components/SkiaSkeletonOverlay';

type Exercise = 'pushup-pyramid' | 'squat' | 'jump-squat' | 'banded-side-step';
type LowerBodyExercise = Exclude<Exercise, 'pushup-pyramid'>;

const coachCopy: Record<string, string> = {
	TOO_CLOSE: 'Move back',
	NO_BODY: 'Step into frame',
	NOT_IN_PLANK: 'Get into push-up position',
	NOT_IN_SQUAT: 'Keep your full body in frame',
	NOT_IN_SIDE_STEPS: 'Keep your full body in frame',
	GO: 'Go',
	STAND_FACING_CAMERA: 'Face the camera',
	READY: 'Ready',
	COUNTING: 'Counting',
};

const squatLabel: Record<SquatVariant, string> = {
	standard: 'Standard',
	jump: 'Jump',
	pulse: 'Pulse',
};

const directionLabel: Record<SideStepDirection, string> = {
	left: 'Left step',
	right: 'Right step',
};

function formatHoldDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, durationMs) / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = (totalSeconds % 60).toFixed(1).padStart(4, '0');
	return `${minutes}:${seconds}`;
}

interface ExerciseTabsProps {
	exercise: Exercise;
	locked?: boolean;
	onSelectExercise: (exercise: Exercise) => void;
}

function ExerciseTabs({ exercise, locked = false, onSelectExercise }: ExerciseTabsProps) {
	const tabs: Array<{ id: Exercise; label: string }> = [
		{ id: 'pushup-pyramid', label: 'Pyramid' },
		{ id: 'squat', label: 'Squats' },
		{ id: 'jump-squat', label: 'Jump Squats' },
		{ id: 'banded-side-step', label: 'Side Steps' },
	];

	return (
		<View pointerEvents="auto" style={styles.modeSwitch}>
			{tabs.map(tab => {
				const selected = exercise === tab.id;
				return (
					<Pressable
						key={tab.id}
						disabled={locked}
						onPress={() => onSelectExercise(tab.id)}
						style={[styles.modeButton, selected && styles.modeButtonSelected, locked && styles.modeButtonDisabled]}
					>
						<Text numberOfLines={2} style={[styles.modeButtonText, selected && styles.modeButtonTextSelected]}>
							{tab.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

function PyramidShape({ level, currentSetIndex }: { level: number; currentSetIndex: number }) {
	return (
		<View accessibilityLabel={`Level ${level} push-up pyramid`} style={styles.pyramidShape}>
			{buildPyramidRows(level).map(row => {
				// The left number represents the climb and the right number the way
				// back down. That lets the active set have a single, unambiguous
				// orange position instead of lighting both matching values.
				const isApexCurrent = row.isApex && currentSetIndex === level - 1;
				const isLeftCurrent = currentSetIndex === row.value - 1;
				const isRightCurrent = currentSetIndex === level * 2 - row.value - 1;
				// Widen each pair as it moves away from the apex. This produces a
				// real triangle instead of vertically stacked matching pairs.
				const pairGap = Math.min(200, 44 + (level - row.value) * 56);

				return (
					<View key={row.value} style={styles.pyramidRow}>
						{row.isApex ? (
							<View style={[styles.pyramidNumber, styles.pyramidApex, isApexCurrent && styles.pyramidNumberActive]}>
								<Text style={styles.pyramidApexText}>{row.value}</Text>
							</View>
						) : (
							<>
								<Text style={[styles.pyramidSideNumber, isLeftCurrent && styles.pyramidSideNumberActive]}>{row.value}</Text>
								<View style={[styles.pyramidGap, { width: pairGap }]} />
								<Text style={[styles.pyramidSideNumber, isRightCurrent && styles.pyramidSideNumberActive]}>{row.value}</Text>
							</>
						)}
					</View>
				);
			})}
		</View>
	);
}

function PyramidLevelCard({ level, onPress }: { level: PyramidLevel; onPress: () => void }) {
	const sequence = [
		...Array.from({ length: level }, (_, index) => index + 1),
		...Array.from({ length: level - 1 }, (_, index) => level - index - 1),
	];
	const description = level === 3 ? 'Starter' : level === 4 ? 'Steady' : 'Challenge';

	return (
		<Pressable accessibilityLabel={`Start level ${level} pyramid`} onPress={onPress} style={styles.levelCard}>
			<View style={styles.levelCardTopRow}>
				<View>
					<Text style={styles.levelEyebrow}>{description}</Text>
					<Text style={styles.levelTitle}>Level {level}</Text>
				</View>
				<Text style={styles.levelReps}>{level * level} REPS</Text>
			</View>
			<Text style={styles.sequenceText}>{sequence.join('  ·  ')}</Text>
		</Pressable>
	);
}

function getPyramidMessage(
	phase: PyramidPhase,
	currentSetIndex: number,
	currentSetTarget: number,
	repsIntoSet: number,
	countdown: number | null,
): { title: string; detail: string } {
	switch (phase) {
		case 'SET_ACTIVE':
			return {
				title: `Set ${currentSetIndex + 1} · ${currentSetTarget} ${currentSetTarget === 1 ? 'rep' : 'reps'}`,
				detail: repsIntoSet === 0 ? 'Rep & Go!' : `${currentSetTarget - repsIntoSet} to finish this set`,
			};
		case 'SET_DONE':
			return { title: 'Set complete', detail: 'Nice work' };
		case 'REST':
			return { title: `Rest · ${countdown ?? 1}`, detail: 'Next set is ready when you are' };
		case 'CELEBRATE':
			return { title: 'Level unlocked!', detail: 'You completed the pyramid' };
		default:
			return { title: '', detail: '' };
	}
}

interface PyramidTrackerProps {
	onSelectExercise: (exercise: Exercise) => void;
}

function PyramidTracker({ onSelectExercise }: PyramidTrackerProps) {
	const insets = useSafeAreaInsets();
	const {
		pose,
		phase,
		level,
		totalReps,
		currentSetIndex,
		currentSetTarget,
		repsIntoSet,
		countdown,
		debugInfo,
		initError,
		androidPerformanceTier,
		solution,
		hasPermission,
		requestPermission,
		startSession,
		resetSession,
	} = usePyramidSession();

	if (!hasPermission) {
		return <PermissionPlaceholder onRequestPermission={requestPermission} />;
	}

	const isReady = phase === 'READY';
	const isTerminal = phase === 'COMPLETE';
	const isActive = !isReady && !isTerminal;
	const message = getPyramidMessage(phase, currentSetIndex, currentSetTarget, repsIntoSet, countdown);

	return (
		<View style={styles.root}>
			<PoseCamera
				style={styles.camera}
				solution={solution}
				activeCamera="front"
				resizeMode="cover"
				performanceTier={androidPerformanceTier}
			/>
			<SkiaSkeletonOverlay pose={pose} />

			<View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
				{isReady ? <ExerciseTabs exercise="pushup-pyramid" onSelectExercise={onSelectExercise} /> : null}

				{isReady ? (
					<View pointerEvents="auto" style={styles.levelPicker}>
						<Text style={styles.levelPickerTitle}>Choose your climb</Text>
						<Text style={styles.levelPickerDetail}>Build up one rep at a time, then come back down.</Text>
						<View style={styles.levelCards}>
							{PYRAMID_LEVEL_OPTIONS.map(option => (
								<PyramidLevelCard key={option} level={option} onPress={() => startSession(option)} />
							))}
						</View>
					</View>
				) : isTerminal ? (
					<View pointerEvents="auto" style={styles.terminalCard}>
						<Text style={styles.terminalIcon}>✓</Text>
						<Text style={styles.terminalTitle}>Level {level} complete</Text>
						<Text style={styles.terminalDetail}>
							{totalReps} push-ups. That is a full pyramid.
						</Text>
						<Pressable style={styles.primaryAction} onPress={() => startSession(level)}>
							<Text style={styles.primaryActionText}>Climb again</Text>
						</Pressable>
						<Pressable style={styles.secondaryAction} onPress={resetSession}>
							<Text style={styles.secondaryActionText}>Choose another level</Text>
						</Pressable>
					</View>
				) : (
					<>
						<View pointerEvents="none" style={[styles.pyramidTop, { top: insets.top + 76 }]}>
							<PyramidShape level={level} currentSetIndex={currentSetIndex} />
						</View>
						<View pointerEvents="none" style={[styles.sessionContent, { bottom: insets.bottom + 24 }]}>
							<View style={styles.sessionStatus}>
								<Text style={styles.sessionTitle}>{message.title}</Text>
								<Text style={styles.sessionDetail}>{message.detail}</Text>
							</View>

							<View style={styles.repRing}>
								<Text style={styles.repRingValue}>{repsIntoSet}/{currentSetTarget}</Text>
								<Text style={styles.repRingLabel}>REPS</Text>
							</View>
						</View>
					</>
				)}

				{isActive ? (
					<Pressable accessibilityLabel="End pyramid workout" onPress={resetSession} style={[styles.exitButton, { top: insets.top + 10 }]}>
						<Text style={styles.exitButtonText}>×</Text>
					</Pressable>
				) : null}

				{initError ? <Text style={styles.error}>{initError}</Text> : null}
				{PUSHUP_PARAMS.DEBUG_HUD ? <DebugPanel info={debugInfo} /> : null}
			</View>
		</View>
	);
}

interface WorkoutTrackerProps {
	exercise: LowerBodyExercise;
	onSelectExercise: (exercise: Exercise) => void;
}

function WorkoutTracker({ exercise, onSelectExercise }: WorkoutTrackerProps) {
	const insets = useSafeAreaInsets();
	const {
		pose,
		repCount,
		squatTracking,
		sideStepTracking,
		coachState,
		isRunning,
		trackingDetail,
		initError,
		androidPerformanceTier,
		solution,
		hasPermission,
		requestPermission,
		start,
		stop,
	} = usePoseSession({ exercise });

	const isSquat = exercise === 'squat';
	const isJumpSquat = exercise === 'jump-squat';
	const isSquatExercise = isSquat || isJumpSquat;
	const isBandedSideStep = exercise === 'banded-side-step';
	const squatCurrentHold = squatTracking.activeHold;
	const squatLastHold = squatTracking.holds[squatTracking.holds.length - 1];
	const sideStepCurrentHold = sideStepTracking.activeHold;
	const sideStepLastHold = sideStepTracking.holds[sideStepTracking.holds.length - 1];
	const holdToShow = isSquatExercise ? squatCurrentHold ?? squatLastHold : sideStepCurrentHold ?? sideStepLastHold;
	const isHolding = isSquatExercise ? squatCurrentHold !== null : sideStepCurrentHold !== null;
	const holdCopy = isJumpSquat
		? squatCurrentHold
			? 'Jump squat - bottom hold'
			: squatLastHold
				? 'Jump squat - last bottom hold'
				: 'Bottom hold'
		: isSquat
			? squatCurrentHold
				? `${squatLabel[squatCurrentHold.variant]} squat - bottom hold`
				: squatLastHold
					? `${squatLabel[squatLastHold.variant]} squat - last bottom hold`
					: 'Bottom hold'
			: sideStepCurrentHold
				? 'Low squat hold'
				: sideStepLastHold
					? 'Last low squat hold'
					: 'Low squat hold';
	const exerciseLabel = isSquat ? 'Squats' : isJumpSquat ? 'Jump Squats' : 'Banded Side Steps';

	if (!hasPermission) {
		return <PermissionPlaceholder onRequestPermission={requestPermission} />;
	}

	return (
		<View style={styles.root}>
			<PoseCamera
				style={styles.camera}
				solution={solution}
				activeCamera="front"
				resizeMode="cover"
				performanceTier={androidPerformanceTier}
			/>
			<SkiaSkeletonOverlay pose={pose} />

			<View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
				<ExerciseTabs exercise={exercise} locked={isRunning} onSelectExercise={onSelectExercise} />
				<View pointerEvents="none" style={styles.lowerHeader}>
					<Text style={styles.label}>{exerciseLabel}</Text>
					<Text style={styles.count}>{repCount}</Text>
					<Text style={styles.coach}>{coachCopy[coachState] ?? coachState}</Text>
					{trackingDetail ? <Text style={styles.trackingDetail}>{trackingDetail}</Text> : null}
					{isSquat ? (
						<View style={styles.squatCounts}>
							<View style={styles.squatCountItem}>
								<Text style={styles.squatCountLabel}>Standard</Text>
								<Text style={styles.squatCountValue}>{squatTracking.repCounts.standard}</Text>
							</View>
							<View style={styles.squatCountItem}>
								<Text style={styles.squatCountLabel}>Pulse</Text>
								<Text style={styles.squatCountValue}>{squatTracking.repCounts.pulse}</Text>
							</View>
						</View>
					) : isBandedSideStep ? (
						<View style={styles.squatCounts}>
							<View style={styles.squatCountItem}>
								<Text style={styles.squatCountLabel}>Left</Text>
								<Text style={styles.squatCountValue}>{sideStepTracking.leftSteps}</Text>
							</View>
							<View style={styles.squatCountItem}>
								<Text style={styles.squatCountLabel}>Right</Text>
								<Text style={styles.squatCountValue}>{sideStepTracking.rightSteps}</Text>
							</View>
						</View>
					) : (
						<View style={styles.squatCounts}>
							<View style={styles.squatCountItem}>
								<Text style={styles.squatCountLabel}>Jump</Text>
								<Text style={styles.squatCountValue}>{squatTracking.repCounts.jump}</Text>
							</View>
						</View>
					)}
					<View style={styles.holdReadout}>
						<Text style={styles.holdLabel}>{holdCopy}</Text>
						<Text style={[styles.holdDuration, isHolding && styles.holdDurationActive]}>
							{holdToShow ? formatHoldDuration(holdToShow.durationMs) : '0:00.0'}
						</Text>
					</View>
					{initError ? <Text style={styles.error}>{initError}</Text> : null}
				</View>
				<View style={styles.controls}>
					<Pressable style={[styles.button, isRunning && styles.stopButton]} onPress={isRunning ? stop : start}>
						<Text style={styles.buttonText}>{isRunning ? 'Stop' : 'Start'}</Text>
					</Pressable>
				</View>
			</View>
		</View>
	);
}

function AppContent() {
	const [exercise, setExercise] = useState<Exercise>('pushup-pyramid');

	if (exercise === 'pushup-pyramid') {
		return <PyramidTracker key={exercise} onSelectExercise={setExercise} />;
	}

	return <WorkoutTracker key={exercise} exercise={exercise} onSelectExercise={setExercise} />;
}

export default function App() {
	return (
		<SafeAreaProvider>
			<AppContent />
		</SafeAreaProvider>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#050505',
	},
	camera: {
		...StyleSheet.absoluteFillObject,
	},
	modeSwitch: {
		alignSelf: 'center',
		flexDirection: 'row',
		width: '92%',
		maxWidth: 420,
		marginTop: 8,
		padding: 3,
		borderRadius: 12,
		backgroundColor: 'rgba(5, 8, 15, 0.72)',
	},
	modeButton: {
		flex: 1,
		minWidth: 0,
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 40,
		borderRadius: 9,
		paddingHorizontal: 4,
		paddingVertical: 6,
	},
	modeButtonSelected: {
		backgroundColor: BRAND_ORANGE,
	},
	modeButtonDisabled: {
		opacity: 0.72,
	},
	modeButtonText: {
		color: '#d4d4d4',
		fontSize: 11,
		fontWeight: '700',
		lineHeight: 13,
		textAlign: 'center',
	},
	modeButtonTextSelected: {
		color: 'white',
	},
	levelPicker: {
		alignSelf: 'center',
		width: '88%',
		maxWidth: 390,
		marginTop: 36,
		padding: 18,
		borderRadius: 20,
		backgroundColor: 'rgba(5, 8, 15, 0.78)',
		borderWidth: 1,
		borderColor: 'rgba(255, 255, 255, 0.14)',
	},
	levelPickerTitle: {
		color: '#fff',
		fontSize: 25,
		fontWeight: '800',
		textAlign: 'center',
	},
	levelPickerDetail: {
		marginTop: 7,
		color: '#d4d8e0',
		fontSize: 14,
		lineHeight: 20,
		textAlign: 'center',
	},
	levelCards: {
		marginTop: 18,
		gap: 10,
	},
	levelCard: {
		paddingHorizontal: 16,
		paddingVertical: 14,
		borderRadius: 14,
		backgroundColor: 'rgba(255, 255, 255, 0.10)',
		borderWidth: 1,
		borderColor: 'rgba(255, 255, 255, 0.14)',
	},
	levelCardTopRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	levelEyebrow: {
		color: '#ffc17c',
		fontSize: 11,
		fontWeight: '800',
		letterSpacing: 0.7,
		textTransform: 'uppercase',
	},
	levelTitle: {
		marginTop: 2,
		color: '#fff',
		fontSize: 20,
		fontWeight: '800',
	},
	levelReps: {
		color: BRAND_ORANGE,
		fontSize: 12,
		fontWeight: '900',
		letterSpacing: 0.5,
	},
	sequenceText: {
		marginTop: 8,
		color: '#edf0f4',
		fontSize: 15,
		fontWeight: '700',
		letterSpacing: 0.8,
	},
	sessionContent: {
		position: 'absolute',
		bottom: 24,
		alignSelf: 'center',
		alignItems: 'center',
		width: '92%',
		maxWidth: 420,
	},
	pyramidTop: {
		position: 'absolute',
		top: 76,
		alignSelf: 'center',
		alignItems: 'center',
		width: '92%',
		maxWidth: 420,
	},
	pyramidShape: {
		alignItems: 'center',
		gap: 2,
		paddingVertical: 6,
	},
	pyramidRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 32,
	},
	pyramidNumber: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	pyramidApex: {
		width: 38,
		height: 38,
		borderRadius: 10,
		backgroundColor: 'rgba(5, 8, 15, 0.56)',
	},
	pyramidNumberActive: {
		backgroundColor: '#ffad3c',
	},
	pyramidApexText: {
		color: '#fff',
		fontSize: 24,
		fontWeight: '900',
	},
	pyramidSideNumber: {
		width: 34,
		color: '#ffffff',
		fontSize: 22,
		fontWeight: '900',
		textAlign: 'center',
		textShadowColor: 'rgba(0, 0, 0, 0.9)',
		textShadowRadius: 3,
	},
	pyramidSideNumberActive: {
		color: '#ffc17c',
	},
	pyramidGap: {
		minWidth: 1,
	},
	sessionStatus: {
		alignItems: 'center',
		marginTop: 13,
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 13,
		backgroundColor: 'rgba(5, 8, 15, 0.72)',
	},
	sessionTitle: {
		color: '#fff',
		fontSize: 19,
		fontWeight: '900',
		textAlign: 'center',
	},
	sessionDetail: {
		marginTop: 3,
		color: '#ffca93',
		fontSize: 13,
		fontWeight: '700',
		textAlign: 'center',
	},
	repRing: {
		alignItems: 'center',
		justifyContent: 'center',
		width: 112,
		height: 112,
		marginTop: 14,
		borderRadius: 56,
		backgroundColor: 'rgba(5, 8, 15, 0.84)',
		borderWidth: 6,
		borderColor: BRAND_ORANGE,
	},
	repRingValue: {
		color: '#fff',
		fontSize: 30,
		fontWeight: '900',
	},
	repRingLabel: {
		marginTop: 1,
		color: '#ffca93',
		fontSize: 10,
		fontWeight: '900',
		letterSpacing: 1.2,
	},
	exitButton: {
		position: 'absolute',
		right: 18,
		alignItems: 'center',
		justifyContent: 'center',
		width: 42,
		height: 42,
		borderRadius: 21,
		backgroundColor: 'rgba(5, 8, 15, 0.78)',
		borderWidth: 1,
		borderColor: 'rgba(255, 255, 255, 0.28)',
	},
	exitButtonText: {
		color: '#fff',
		fontSize: 31,
		fontWeight: '400',
		lineHeight: 35,
	},
	terminalCard: {
		alignSelf: 'center',
		alignItems: 'center',
		width: '86%',
		maxWidth: 360,
		marginTop: 54,
		padding: 24,
		borderRadius: 22,
		backgroundColor: 'rgba(5, 8, 15, 0.84)',
		borderWidth: 1,
		borderColor: 'rgba(255, 255, 255, 0.16)',
	},
	terminalIcon: {
		alignItems: 'center',
		justifyContent: 'center',
		width: 58,
		height: 58,
		borderRadius: 29,
		overflow: 'hidden',
		color: '#fff',
		backgroundColor: BRAND_ORANGE,
		fontSize: 38,
		fontWeight: '900',
		lineHeight: 58,
		textAlign: 'center',
	},
	terminalTitle: {
		marginTop: 15,
		color: '#fff',
		fontSize: 25,
		fontWeight: '900',
		textAlign: 'center',
	},
	terminalDetail: {
		marginTop: 8,
		color: '#d4d8e0',
		fontSize: 14,
		lineHeight: 20,
		textAlign: 'center',
	},
	primaryAction: {
		alignSelf: 'stretch',
		alignItems: 'center',
		marginTop: 22,
		paddingVertical: 13,
		borderRadius: 12,
		backgroundColor: BRAND_ORANGE,
	},
	primaryActionText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '900',
	},
	secondaryAction: {
		paddingTop: 17,
		paddingBottom: 3,
	},
	secondaryActionText: {
		color: '#fff',
		fontSize: 14,
		fontWeight: '800',
	},
	lowerHeader: {
		alignSelf: 'center',
		alignItems: 'center',
		minWidth: 272,
		marginTop: 16,
		paddingHorizontal: 18,
		paddingVertical: 12,
		borderRadius: 8,
		backgroundColor: 'rgba(0, 0, 0, 0.55)',
	},
	label: {
		color: '#d4d4d4',
		fontSize: 13,
		fontWeight: '600',
		textTransform: 'uppercase',
	},
	count: {
		color: 'white',
		fontSize: 56,
		lineHeight: 62,
		fontWeight: '800',
	},
	coach: {
		color: BRAND_ORANGE,
		fontSize: 18,
		fontWeight: '700',
		textAlign: 'center',
	},
	trackingDetail: {
		maxWidth: 300,
		marginTop: 4,
		color: '#d4d4d4',
		fontSize: 12,
		fontWeight: '600',
		textAlign: 'center',
	},
	squatCounts: {
		alignSelf: 'stretch',
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginTop: 12,
		paddingTop: 10,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: '#575757',
	},
	squatCountItem: {
		alignItems: 'center',
		flex: 1,
	},
	squatCountLabel: {
		color: '#bdbdbd',
		fontSize: 12,
		fontWeight: '600',
	},
	squatCountValue: {
		marginTop: 2,
		color: 'white',
		fontSize: 24,
		fontWeight: '800',
	},
	holdReadout: {
		alignSelf: 'stretch',
		alignItems: 'center',
		marginTop: 10,
		paddingTop: 10,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: '#575757',
	},
	holdLabel: {
		color: '#d4d4d4',
		fontSize: 12,
		fontWeight: '600',
	},
	holdDuration: {
		marginTop: 2,
		color: 'white',
		fontSize: 28,
		fontWeight: '800',
	},
	holdDurationActive: {
		color: '#ffcf9f',
	},
	error: {
		position: 'absolute',
		alignSelf: 'center',
		bottom: 88,
		maxWidth: 280,
		paddingHorizontal: 10,
		color: '#ffb4b4',
		fontSize: 13,
		textAlign: 'center',
		backgroundColor: 'rgba(0, 0, 0, 0.55)',
	},
	controls: {
		position: 'absolute',
		right: 20,
		bottom: 36,
	},
	button: {
		minWidth: 116,
		alignItems: 'center',
		borderRadius: 8,
		backgroundColor: BRAND_ORANGE,
		paddingHorizontal: 20,
		paddingVertical: 14,
	},
	stopButton: {
		backgroundColor: '#222',
		borderWidth: 1,
		borderColor: '#555',
	},
	buttonText: {
		color: 'white',
		fontSize: 17,
		fontWeight: '800',
	},
});
