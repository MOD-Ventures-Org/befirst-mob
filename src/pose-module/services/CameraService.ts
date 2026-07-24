import { useCallback, useRef } from 'react';

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

interface CameraServiceCallbacks {
  onResults: (results: PoseDetectionResultBundle, vc: ViewCoordinator) => void;
  onError?: (error: DetectionError) => void;
  processingFps: number;
}

export function useCameraService({ onResults, onError, processingFps }: CameraServiceCallbacks) {
  const { hasPermission, requestPermission } = useCameraPermission();

  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stableOnResults = useCallback<typeof onResults>((...args) => {
    onResultsRef.current(...args);
  }, []);

  const stableOnError = useCallback<NonNullable<typeof onError>>(error => {
    if (onErrorRef.current) {
      onErrorRef.current(error);
    } else {
      console.error('PoseDetection error:', error);
    }
  }, []);

  const solution = usePoseDetection(
    { onResults: stableOnResults, onError: stableOnError },
    RunningMode.LIVE_STREAM,
    MODEL_PATH,
    {
      // react-native-mediapipe emits a result only when it finds a pose. An
      // empty camera frame is therefore not evidence of a failed GPU delegate.
      // Falling back after a few no-pose frames previously forced Android into
      // much slower CPU inference before the athlete had entered the frame.
      delegate: Delegate.GPU,
      // One person, higher confidence -> reject "other objects as a person" and
      // weak ghost poses that made the skeleton lose focus / drift.
      numPoses: 1,
      minPoseDetectionConfidence: PUSHUP_PARAMS.DETECT_CONF,
      minPosePresenceConfidence: PUSHUP_PARAMS.PRESENCE_CONF,
      minTrackingConfidence: PUSHUP_PARAMS.TRACKING_CONF,
      fpsMode: processingFps,
      // Lock only the OUTPUT orientation to portrait. The trainer screen is
      // portrait, so this stops the auto orientation from oscillating on a flat
      // phone (the skeleton flipping/drifting), while leaving the CAMERA/frame
      // orientation auto so convertPoint still maps the skeleton onto the body.
      forceOutputOrientation: 'portrait',
    },
  );

  return { solution, hasPermission, requestPermission };
}
