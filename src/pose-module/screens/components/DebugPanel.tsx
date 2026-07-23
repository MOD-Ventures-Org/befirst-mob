import { StyleSheet, Text, View } from 'react-native';

import type { DebugInfo } from '@/src/pose-module/types';

interface Props {
  info: DebugInfo | null;
}

export function DebugPanel({ info }: Props) {
  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.text}>state: {info?.phase ?? '—'}</Text>
      <Text style={styles.text}>coach: {info?.coach ?? '—'}</Text>
      <Text style={styles.text}>reps: {info?.repCount ?? 0}</Text>
      <Text style={styles.text}>fps: {info?.fps ?? 0}</Text>
      <Text style={styles.text}>proc: {info?.inferenceMs ?? 0}ms</Text>
      <Text style={styles.text}>
        conf: {info?.conf !== undefined ? info.conf.toFixed(2) : '—'} (min{' '}
        {info?.minConf !== undefined ? info.minConf.toFixed(2) : '—'})
      </Text>
      <Text style={styles.text}>landmarks: {info?.landmarksDetected ? 'yes' : 'no'}</Text>
      <Text style={styles.text}>tier: {info?.tier ?? '—'}</Text>
      <Text style={styles.text}>
        depth: {info?.depth !== undefined && info.depth !== null ? info.depth.toFixed(3) : '—'}
      </Text>
      <Text style={styles.text}>plank: {info?.plankish === undefined ? '—' : info.plankish ? 'yes' : 'no'}</Text>
      <Text style={styles.text}>counting: {info?.counting === undefined ? '—' : info.counting ? 'yes' : 'no'}</Text>
      <Text style={styles.text}>missing: {info?.missingFrames ?? 0}</Text>
      {!info && <Text style={styles.text}>waiting for pose…</Text>}
      {info?.angles && (
        <>
          <Text style={styles.text}>— angles —</Text>
          <Text style={styles.text}>elbow L/R: {Math.round(info.angles.leftElbow)}° / {Math.round(info.angles.rightElbow)}°</Text>
          <Text style={styles.text}>knee L/R: {Math.round(info.angles.leftKnee)}° / {Math.round(info.angles.rightKnee)}°</Text>
          <Text style={styles.text}>hip L/R: {Math.round(info.angles.leftHip)}° / {Math.round(info.angles.rightHip)}°</Text>
          <Text style={styles.text}>spine: {Math.round(info.angles.spine)}°</Text>
          <Text style={styles.text}>back: {Math.round(info.angles.backAngle)}°</Text>
          <Text style={styles.text}>
            flare L/R: {Math.round(info.angles.elbowFlareLeft)}° / {Math.round(info.angles.elbowFlareRight)}°
          </Text>
        </>
      )}
      {info?.velocities && (
        <>
          <Text style={styles.text}>— velocity px/s —</Text>
          <Text style={styles.text}>pelvis: {Math.round(info.velocities.pelvis)}</Text>
          <Text style={styles.text}>
            wrist L/R: {Math.round(info.velocities.leftWrist)} / {Math.round(info.velocities.rightWrist)}
          </Text>
          <Text style={styles.text}>
            ankle L/R: {Math.round(info.velocities.leftAnkle)} / {Math.round(info.velocities.rightAnkle)}
          </Text>
          <Text style={styles.text}>nose: {Math.round(info.velocities.nose)}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 110,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 8,
    borderRadius: 8,
    gap: 2,
    zIndex: 6,
  },
  text: {
    color: '#00ff00',
    fontFamily: 'monospace',
    fontSize: 12,
  },
});
