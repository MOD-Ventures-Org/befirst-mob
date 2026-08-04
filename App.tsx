import React, { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { usePoseSession } from './src/pose-module';
import { PUSHUP_PARAMS } from './src/pose-module/exercises/pushup.config';
import type { SideStepDirection } from './src/pose-module/side-steps/BandedSideStepDetector';
import type { SquatVariant } from './src/pose-module/squats/SquatDetector';
import { DebugPanel } from './src/pose-module/screens/components/DebugPanel';
import PermissionPlaceholder from './src/pose-module/screens/components/PermissionPlaceholder';
import PoseCamera from './src/pose-module/screens/components/PoseCamera';
import SkiaSkeletonOverlay from './src/pose-module/screens/components/SkiaSkeletonOverlay';

type Exercise = 'pushup' | 'squat' | 'jump-squat' | 'banded-side-step';

const coachCopy: Record<string, string> = {
	TOO_CLOSE: 'Move back',
	NO_BODY: 'Stand in frame',
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

interface WorkoutTrackerProps {
	exercise: Exercise;
	onSelectExercise: (exercise: Exercise) => void;
}

function WorkoutTracker({ exercise, onSelectExercise }: WorkoutTrackerProps) {
	const {
		pose,
		repCount,
		squatTracking,
		sideStepTracking,
		coachState,
		isRunning,
		debugInfo,
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
	const isLowerBodyExercise = isSquatExercise || isBandedSideStep;
	const squatCurrentHold = squatTracking.activeHold;
	const squatLastHold = squatTracking.holds[squatTracking.holds.length - 1];
	const sideStepCurrentHold = sideStepTracking.activeHold;
	const sideStepLastHold = sideStepTracking.holds[sideStepTracking.holds.length - 1];
	const holdToShow = isSquatExercise
		? squatCurrentHold ?? squatLastHold
		: isBandedSideStep
			? sideStepCurrentHold ?? sideStepLastHold
			: null;
	const isHolding = isSquatExercise ? squatCurrentHold !== null : isBandedSideStep ? sideStepCurrentHold !== null : false;
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
	const exerciseLabel = isSquat ? 'Squats' : isJumpSquat ? 'Jump Squats' : isBandedSideStep ? 'Banded Side Steps' : 'Push-ups';

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

			<SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
				<View pointerEvents="auto" style={styles.modeSwitch}>
					<Pressable
						disabled={isRunning}
						onPress={() => onSelectExercise('pushup')}
						style={[styles.modeButton, exercise === 'pushup' && styles.modeButtonSelected, isRunning && styles.modeButtonDisabled]}
					>
						<Text style={[styles.modeButtonText, exercise === 'pushup' && styles.modeButtonTextSelected]}>Push-ups</Text>
					</Pressable>
					<Pressable
						disabled={isRunning}
						onPress={() => onSelectExercise('squat')}
						style={[styles.modeButton, exercise === 'squat' && styles.modeButtonSelected, isRunning && styles.modeButtonDisabled]}
					>
						<Text style={[styles.modeButtonText, exercise === 'squat' && styles.modeButtonTextSelected]}>Squats</Text>
					</Pressable>
					<Pressable
						disabled={isRunning}
						onPress={() => onSelectExercise('jump-squat')}
						style={[styles.modeButton, exercise === 'jump-squat' && styles.modeButtonSelected, isRunning && styles.modeButtonDisabled]}
					>
						<Text numberOfLines={2} style={[styles.modeButtonText, exercise === 'jump-squat' && styles.modeButtonTextSelected]}>
							Jump Squats
						</Text>
					</Pressable>
					<Pressable
						disabled={isRunning}
						onPress={() => onSelectExercise('banded-side-step')}
						style={[styles.modeButton, exercise === 'banded-side-step' && styles.modeButtonSelected, isRunning && styles.modeButtonDisabled]}
					>
						<Text numberOfLines={2} style={[styles.modeButtonText, exercise === 'banded-side-step' && styles.modeButtonTextSelected]}>
							Side Steps
						</Text>
					</Pressable>
				</View>

				<View pointerEvents="none" style={[styles.header, isLowerBodyExercise && styles.squatHeader]}>
					<Text style={styles.label}>{exerciseLabel}</Text>
					<Text style={styles.count}>{repCount}</Text>
					<Text style={styles.coach}>{coachCopy[coachState] ?? coachState}</Text>
					{trackingDetail ? <Text style={styles.trackingDetail}>{trackingDetail}</Text> : null}
					{isSquat ? (
						<>
							{squatTracking.activeVariant ? (
								<Text style={styles.detectedVariant}>Detected: {squatLabel[squatTracking.activeVariant]}</Text>
							) : null}
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
							<View style={styles.holdReadout}>
								<Text style={styles.holdLabel}>{holdCopy}</Text>
								<Text style={[styles.holdDuration, isHolding && styles.holdDurationActive]}>
									{holdToShow ? formatHoldDuration(holdToShow.durationMs) : '0:00.0'}
								</Text>
							</View>
						</>
					) : isBandedSideStep ? (
						<>
							{sideStepTracking.activeDirection ? (
								<Text style={styles.detectedVariant}>Detected: {directionLabel[sideStepTracking.activeDirection]}</Text>
							) : null}
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
							<View style={styles.holdReadout}>
								<Text style={styles.holdLabel}>{holdCopy}</Text>
								<Text style={[styles.holdDuration, isHolding && styles.holdDurationActive]}>
									{holdToShow ? formatHoldDuration(holdToShow.durationMs) : '0:00.0'}
								</Text>
							</View>
						</>
					) : isJumpSquat ? (
						<>
							{squatTracking.activeVariant === 'jump' ? (
								<Text style={styles.detectedVariant}>Jump in progress</Text>
							) : null}
							<View style={styles.squatCounts}>
								<View style={styles.squatCountItem}>
									<Text style={styles.squatCountLabel}>Jump</Text>
									<Text style={styles.squatCountValue}>{squatTracking.repCounts.jump}</Text>
								</View>
							</View>
							<View style={styles.holdReadout}>
								<Text style={styles.holdLabel}>{holdCopy}</Text>
								<Text style={[styles.holdDuration, isHolding && styles.holdDurationActive]}>
									{holdToShow ? formatHoldDuration(holdToShow.durationMs) : '0:00.0'}
								</Text>
							</View>
						</>
					) : null}
					{initError ? <Text style={styles.error}>{initError}</Text> : null}
				</View>

				<View style={styles.controls}>
					<Pressable style={[styles.button, isRunning && styles.stopButton]} onPress={isRunning ? stop : start}>
						<Text style={styles.buttonText}>{isRunning ? 'Stop' : 'Start'}</Text>
					</Pressable>
				</View>

				{!isLowerBodyExercise && PUSHUP_PARAMS.DEBUG_HUD ? <DebugPanel info={debugInfo} /> : null}
			</SafeAreaView>
		</View>
	);
}

export default function App() {
	const [exercise, setExercise] = useState<Exercise>('pushup');

	// A fresh keyed tracker gives each exercise its own calibrated motion state.
	return <WorkoutTracker key={exercise} exercise={exercise} onSelectExercise={setExercise} />;
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
		borderRadius: 8,
		backgroundColor: 'rgba(0, 0, 0, 0.58)',
	},
	modeButton: {
		flex: 1,
		minWidth: 0,
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 40,
		borderRadius: 6,
		paddingHorizontal: 4,
		paddingVertical: 6,
	},
	modeButtonSelected: {
		backgroundColor: '#ff7a1a',
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
	header: {
		alignSelf: 'center',
		alignItems: 'center',
		marginTop: 16,
		paddingHorizontal: 18,
		paddingVertical: 12,
		borderRadius: 8,
		backgroundColor: 'rgba(0, 0, 0, 0.55)',
	},
	squatHeader: {
		minWidth: 272,
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
		color: '#ff7a1a',
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
	detectedVariant: {
		marginTop: 4,
		color: '#ffcf9f',
		fontSize: 13,
		fontWeight: '700',
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
		maxWidth: 280,
		marginTop: 8,
		color: '#ffb4b4',
		fontSize: 13,
		textAlign: 'center',
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
		backgroundColor: '#ff7a1a',
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
