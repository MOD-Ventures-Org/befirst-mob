import type { PoseDetectionResultBundle, ViewCoordinator } from 'react-native-mediapipe';

import type { Joint, JointVisibility, PoseFrame, Skeleton } from '../types';

// MediaPipe PoseLandmarker landmark index for each skeleton joint.
const JOINT_LANDMARK_INDEX: Record<keyof Skeleton, number> = {
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
  if (!landmarks || landmarks.length < 33) {
    return null; // Not enough landmarks detected
  }

  const frameDims = vc.getFrameDims(results);

  const skeleton = {} as Skeleton;
  const normalized = {} as Skeleton;
  const visibility = {} as JointVisibility;

  for (const joint of Object.keys(JOINT_LANDMARK_INDEX) as (keyof Skeleton)[]) {
    const landmark = landmarks[JOINT_LANDMARK_INDEX[joint]];
    skeleton[joint] = vc.convertPoint(frameDims, landmark);
    normalized[joint] = { x: landmark.x, y: landmark.y };
    visibility[joint] = landmark.visibility ?? landmark.presence ?? 1;
  }

  return { skeleton, normalized, visibility };
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
