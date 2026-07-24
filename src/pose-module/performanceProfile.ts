import { Platform } from 'react-native';

// Pose landmarks do not need a 4K camera stream. Keeping the preview at 720p
// cuts camera/GPU bandwidth substantially on Android while leaving enough
// detail for the full MediaPipe pose model.
export const ANDROID_CAMERA_FORMAT = {
	width: 1280,
	height: 720,
} as const;

export const ANDROID_CAMERA_FPS = 30;

// The native pose plugin otherwise processes every camera frame. A full model
// at 30 FPS can build a backlog on mid-range Android GPUs, which makes both
// the camera preview and the skeleton feel delayed. Twenty fresh inferences a
// second keeps push-up motion and counting responsive without changing the
// landmark model or detector thresholds.
export const POSE_INFERENCE_FPS = {
	idle: Platform.OS === 'android' ? 12 : 20,
	active: Platform.OS === 'android' ? 20 : 30,
} as const;

export const USE_LIGHTWEIGHT_ANDROID_OVERLAY = Platform.OS === 'android';
