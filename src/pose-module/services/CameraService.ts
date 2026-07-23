import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Delegate,
  type DetectionError,
  type PoseDetectionResultBundle,
  RunningMode,
  type ViewCoordinator,
  usePoseDetection,
} from 'react-native-mediapipe';
import { useCameraPermission } from 'react-native-vision-camera';

import { PUSHUP_PARAMS } from '../exercises/pushup.config';

// Only the `full` tier ships in the app bundle today; PUSHUP_PARAMS.POSE_MODEL
// picks the file, so switching tiers also requires bundling the model asset.
const MODEL_PATH = `pose_landmarker_${PUSHUP_PARAMS.POSE_MODEL}.task`;

export const POSE_MODEL_NAME = PUSHUP_PARAMS.POSE_MODEL;

// Some Android GPUs/drivers fail the MediaPipe GPU delegate with no catchable
// JS signal (the lib swallows the native error, and MediaPipe only reports real
// landmark results to JS, never an "ok, empty frame"). So a broken delegate is
// only observable as "results stop arriving". Two failure shapes seen on real
// devices: (a) never initializes (no result ever), and (b) initializes, emits a
// frame or two, then dies (skeleton draws then freezes, reps stop). We watch for
// both and fall back to CPU.
//
// A person resting IN frame still produces results (a static pose is still a
// pose), so a stall only happens when the delegate dies or the person leaves
// frame; the latter just causes a harmless one-time switch to CPU, which also
// works. GPU_START_GRACE_MS clears camera warmup + first detection on a healthy
// device; GPU_STALL_MS catches a delegate that dies mid-session.
const GPU_START_GRACE_MS = 2000;
const GPU_STALL_MS = 3000;

interface CameraServiceCallbacks {
  onResults: (results: PoseDetectionResultBundle, vc: ViewCoordinator) => void;
  onError?: (error: DetectionError) => void;
}

export function useCameraService({ onResults, onError }: CameraServiceCallbacks) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [delegate, setDelegate] = useState<Delegate>(Delegate.GPU);
  const hasSeenResultRef = useRef(false);
  const lastResultAtRef = useRef<number | null>(null);

  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stableOnResults = useCallback<typeof onResults>((...args) => {
    hasSeenResultRef.current = true;
    lastResultAtRef.current = Date.now();
    onResultsRef.current(...args);
  }, []);

  const stableOnError = useCallback<NonNullable<typeof onError>>(error => {
    if (onErrorRef.current) {
      onErrorRef.current(error);
    } else {
      console.error('PoseDetection error:', error);
    }
  }, []);

  useEffect(() => {
    if (!hasPermission || delegate === Delegate.CPU) return;

    const startedAt = Date.now();
    hasSeenResultRef.current = false;
    lastResultAtRef.current = null;
    let fellBack = false;

    const watchdog = setInterval(() => {
      if (fellBack) return;
      const reference = lastResultAtRef.current ?? startedAt;
      const threshold = hasSeenResultRef.current ? GPU_STALL_MS : GPU_START_GRACE_MS;
      if (Date.now() - reference > threshold) {
        fellBack = true;
        setDelegate(Delegate.CPU);
      }
    }, 500);

    return () => clearInterval(watchdog);
  }, [hasPermission, delegate]);

  const solution = usePoseDetection(
    { onResults: stableOnResults, onError: stableOnError },
    RunningMode.LIVE_STREAM,
    MODEL_PATH,
    {
      delegate,
      // One person, higher confidence -> reject "other objects as a person" and
      // weak ghost poses that made the skeleton lose focus / drift.
      numPoses: 1,
      minPoseDetectionConfidence: PUSHUP_PARAMS.DETECT_CONF,
      minPosePresenceConfidence: PUSHUP_PARAMS.PRESENCE_CONF,
      minTrackingConfidence: PUSHUP_PARAMS.TRACKING_CONF,
      // Lock only the OUTPUT orientation to portrait. The trainer screen is
      // portrait, so this stops the auto orientation from oscillating on a flat
      // phone (the skeleton flipping/drifting), while leaving the CAMERA/frame
      // orientation auto so convertPoint still maps the skeleton onto the body.
      forceOutputOrientation: 'portrait',
    },
  );

  return { solution, hasPermission, requestPermission };
}
