import { Platform } from 'react-native';

export const ANDROID_CAMERA_FPS = 30;

export type AndroidPerformanceTier = 'high' | 'mid' | 'low';

interface AndroidCameraProfile {
	cameraFormat: { width: number; height: number };
	idleInferenceFps: number;
	activeInferenceFps: number;
}

export interface AndroidPerformanceSample {
	inferenceP95Ms: number;
	cvFps: number;
	targetFps: number;
	sampleCount: number;
}

// Every device starts at the high-quality profile. The runtime benchmark only
// moves downward, so a camera format never switches back and forth mid-workout.
const ANDROID_CAMERA_PROFILES: Record<AndroidPerformanceTier, AndroidCameraProfile> = {
	high: {
		cameraFormat: { width: 1280, height: 720 },
		idleInferenceFps: 12,
		activeInferenceFps: 20,
	},
	mid: {
		cameraFormat: { width: 960, height: 540 },
		idleInferenceFps: 10,
		activeInferenceFps: 15,
	},
	low: {
		cameraFormat: { width: 640, height: 480 },
		idleInferenceFps: 8,
		activeInferenceFps: 12,
	},
};

// Thirty-six samples is about three seconds while idle and avoids making a
// decision from camera startup work or one transient GPU hitch.
export const ANDROID_PROFILE_WARMUP_SAMPLES = 36;
export const ANDROID_PROFILE_EVALUATION_INTERVAL_FRAMES = 12;

const TIER_RANK: Record<AndroidPerformanceTier, number> = {
	high: 0,
	mid: 1,
	low: 2,
};

export const getAndroidCameraProfile = (tier: AndroidPerformanceTier): AndroidCameraProfile =>
	ANDROID_CAMERA_PROFILES[tier];

export const getPoseInferenceFps = (tier: AndroidPerformanceTier, isRunning: boolean): number => {
	if (Platform.OS !== 'android') return isRunning ? 30 : 20;
	const profile = getAndroidCameraProfile(tier);
	return isRunning ? profile.activeInferenceFps : profile.idleInferenceFps;
};

// Inference time is measured on the actual device and catches thermal
// throttling, weak GPUs and OS load more reliably than a hard-coded phone list.
export const resolveAndroidPerformanceTier = ({
	inferenceP95Ms,
	cvFps,
	targetFps,
	sampleCount,
}: AndroidPerformanceSample): AndroidPerformanceTier => {
	if (sampleCount < ANDROID_PROFILE_WARMUP_SAMPLES) return 'high';

	if (inferenceP95Ms >= 90 || cvFps < Math.max(8, targetFps - 7)) return 'low';
	if (inferenceP95Ms >= 55 || cvFps < Math.max(10, targetFps - 4)) return 'mid';
	return 'high';
};

export const shouldDowngradeAndroidProfile = (
	current: AndroidPerformanceTier,
	next: AndroidPerformanceTier,
): boolean => TIER_RANK[next] > TIER_RANK[current];

export const USE_LIGHTWEIGHT_ANDROID_OVERLAY = Platform.OS === 'android';
