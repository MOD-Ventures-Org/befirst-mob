import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { usePoseSession } from './src/pose-module';
import { PUSHUP_PARAMS } from './src/pose-module/exercises/pushup.config';
import { DebugPanel } from './src/pose-module/screens/components/DebugPanel';
import PermissionPlaceholder from './src/pose-module/screens/components/PermissionPlaceholder';
import PoseCamera from './src/pose-module/screens/components/PoseCamera';
import SkiaSkeletonOverlay from './src/pose-module/screens/components/SkiaSkeletonOverlay';

const coachCopy: Record<string, string> = {
  TOO_CLOSE: 'Move back',
  NO_BODY: 'Stand in frame',
  NOT_IN_PLANK: 'Get into push-up position',
  GO: 'Go',
  STAND_FACING_CAMERA: 'Face the camera',
  READY: 'Ready',
  COUNTING: 'Counting',
};

export default function App() {
  const {
    pose,
    repCount,
    coachState,
    isRunning,
    debugInfo,
    initError,
    androidPerformanceTier,
    solution,
    hasPermission,
    requestPermission,
    start,
    stop,
  } = usePoseSession({ exercise: 'pushup' });

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
        <View style={styles.header} pointerEvents="none">
          <Text style={styles.label}>Push-ups</Text>
          <Text style={styles.count}>{repCount}</Text>
          <Text style={styles.coach}>{coachCopy[coachState] ?? coachState}</Text>
          {initError ? <Text style={styles.error}>{initError}</Text> : null}
        </View>

        <View style={styles.controls}>
          <Pressable style={[styles.button, isRunning && styles.stopButton]} onPress={isRunning ? stop : start}>
            <Text style={styles.buttonText}>{isRunning ? 'Stop' : 'Start'}</Text>
          </Pressable>
        </View>

        {PUSHUP_PARAMS.DEBUG_HUD ? <DebugPanel info={debugInfo} /> : null}
      </SafeAreaView>
    </View>
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
    backgroundColor: '#050505',
  },
  title: {
    color: 'white',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  muted: {
    color: '#c8c8c8',
    fontSize: 15,
    textAlign: 'center',
  },
  header: {
    alignSelf: 'center',
    alignItems: 'center',
    marginTop: 20,
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
    color: '#ff7a1a',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
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
