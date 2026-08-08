import type { PoseDetectionResultBundle, ViewCoordinator } from 'react-native-mediapipe';

import type {
	FootLandmarkName,
	FootLandmarks,
	FootVisibility,
	Joint,
	JointVisibility,
	PoseFrame,
	Skeleton,
	WorldFootLandmarks,
	WorldSkeleton,
} from '../types';

// MediaPipe PoseLandmarker landmark index for each skeleton joint.
export const CORE_JOINT_LANDMARK_INDEX: Record<keyof Skeleton, number> = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

// These points are deliberately kept out of the rendered stick figure. They
// feed lower-body movement signals only: heel/toe positions survive some ankle
// jitter and let Jump Squats use the lowest visible point of each foot.
export const FOOT_JOINT_LANDMARK_INDEX: Record<FootLandmarkName, number> = {
	leftHeel: 29,
	rightHeel: 30,
	leftFootIndex: 31,
	rightFootIndex: 32,
};

/**
 * Map MediaPipe landmarks to on-screen pixels.
 *
 * The library's `ViewCoordinator.convertPoint` is the source of truth for the
 * transform: it rotates the normalized landmark for the real frame/output
 * orientation, denormalizes against the frame dims, fits to the measured view
 * with the camera's resize mode, and mirrors the front camera. We only read the
 * per-joint visibility on top of it so the overlay can colour and gate joints.
 */
export function toSkeleton(
  results: PoseDetectionResultBundle,
  vc: ViewCoordinator,
): PoseFrame | null {
  const landmarks = results.results[0]?.landmarks[0];
  const worldLandmarks = results.results[0]?.worldLandmarks?.[0];
  if (!landmarks || landmarks.length < 33) {
    return null; // Not enough landmarks detected
  }

  const frameDims = vc.getFrameDims(results);

  const skeleton = {} as Skeleton;
  const normalized = {} as Skeleton;
  const world = worldLandmarks && worldLandmarks.length >= 33 ? ({} as WorldSkeleton) : undefined;
  const visibility = {} as JointVisibility;
  const feet = {} as FootLandmarks;
  const normalizedFeet = {} as FootLandmarks;
  const worldFeet = worldLandmarks && worldLandmarks.length >= 33 ? ({} as WorldFootLandmarks) : undefined;
  const footVisibility = {} as FootVisibility;

  for (const joint of Object.keys(CORE_JOINT_LANDMARK_INDEX) as (keyof Skeleton)[]) {
    const landmark = landmarks[CORE_JOINT_LANDMARK_INDEX[joint]];
    skeleton[joint] = vc.convertPoint(frameDims, landmark);
    normalized[joint] = { x: landmark.x, y: landmark.y };
    if (world) {
      const worldLandmark = worldLandmarks![CORE_JOINT_LANDMARK_INDEX[joint]];
      world[joint] = { x: worldLandmark.x, y: worldLandmark.y, z: worldLandmark.z };
    }
    visibility[joint] = landmark.visibility ?? landmark.presence ?? 1;
  }

  for (const joint of Object.keys(FOOT_JOINT_LANDMARK_INDEX) as FootLandmarkName[]) {
		const landmark = landmarks[FOOT_JOINT_LANDMARK_INDEX[joint]];
		feet[joint] = vc.convertPoint(frameDims, landmark);
		normalizedFeet[joint] = { x: landmark.x, y: landmark.y };
		if (worldFeet) {
			const worldLandmark = worldLandmarks![FOOT_JOINT_LANDMARK_INDEX[joint]];
			worldFeet[joint] = { x: worldLandmark.x, y: worldLandmark.y, z: worldLandmark.z };
		}
		footVisibility[joint] = landmark.visibility ?? landmark.presence ?? 1;
	}

  return {
		skeleton,
		normalized,
		...(world ? { world } : {}),
		visibility,
		feet: {
			skeleton: feet,
			normalized: normalizedFeet,
			...(worldFeet ? { world: worldFeet } : {}),
			visibility: footVisibility,
		},
	};
}

export function toSkeletonFromImage(
  results: PoseDetectionResultBundle,
  displayWidth: number,
  displayHeight: number,
  videoNativeWidth: number,
  videoNativeHeight: number,
): Skeleton | null {
  const landmarks = results.results[0]?.landmarks[0];

  if (!landmarks || landmarks.length < 33) {
    return null; // Not enough landmarks detected
  }

  // Compute the rendered rect of the video within the display view (resizeMode="contain")
  const videoAspect = videoNativeWidth / videoNativeHeight;
  const viewAspect = displayWidth / displayHeight;

  let renderedWidth: number;
  let renderedHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (videoAspect > viewAspect) {
    // Video is wider than the view - letterboxed (bars on top and bottom)
    renderedWidth = displayWidth;
    renderedHeight = displayWidth / videoAspect;
    offsetX = 0;
    offsetY = (displayHeight - renderedHeight) / 2;
  } else {
    // Video is taller than the view - pillarboxed (bars on left and right)
    renderedHeight = displayHeight;
    renderedWidth = displayHeight * videoAspect;
    offsetX = (displayWidth - renderedWidth) / 2;
    offsetY = 0;
  }

  // MediaPipe IMAGE mode returns normalized [0, 1] coords
  // relative to the input image - map them into the rendered video rect
  const p = (i: number): Joint => ({
    x: offsetX + landmarks[i].x * renderedWidth,
    y: offsetY + landmarks[i].y * renderedHeight,
  });

  return {
    nose: p(0),
    leftEye: p(2),
    rightEye: p(5),
    leftEar: p(7),
    rightEar: p(8),
    leftShoulder: p(11),
    rightShoulder: p(12),
    leftElbow: p(13),
    rightElbow: p(14),
    leftWrist: p(15),
    rightWrist: p(16),
    leftHip: p(23),
    rightHip: p(24),
    leftKnee: p(25),
    rightKnee: p(26),
    leftAnkle: p(27),
    rightAnkle: p(28),
  };
}
