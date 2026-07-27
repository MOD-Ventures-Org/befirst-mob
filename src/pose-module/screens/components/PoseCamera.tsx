import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { MediapipeCamera } from 'react-native-mediapipe';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';

import {
	ANDROID_CAMERA_FPS,
	getAndroidCameraProfile,
	type AndroidPerformanceTier,
} from '../../performanceProfile';

type PoseCameraProps = React.ComponentProps<typeof MediapipeCamera> & {
	performanceTier?: AndroidPerformanceTier;
};

const AndroidPoseCamera = ({
	style,
	solution,
	activeCamera = 'front',
	resizeMode = 'cover',
	performanceTier = 'high',
}: PoseCameraProps) => {
	const device = useCameraDevice(activeCamera);
	const cameraProfile = getAndroidCameraProfile(performanceTier);
	const format = useCameraFormat(device, [
		{ videoResolution: cameraProfile.cameraFormat },
		{ fps: ANDROID_CAMERA_FPS },
	]);

	useEffect(() => {
		solution.cameraDeviceChangeHandler(device);
	}, [device, solution]);

	useEffect(() => {
		solution.resizeModeChangeHandler(resizeMode);
	}, [resizeMode, solution]);

	if (!device) return null;

	return (
		<Camera
			style={style}
			device={device}
			format={format}
			fps={Math.min(ANDROID_CAMERA_FPS, format?.maxFps ?? ANDROID_CAMERA_FPS)}
			resizeMode={resizeMode}
			pixelFormat="rgb"
			isActive
			frameProcessor={solution.frameProcessor}
			onLayout={solution.cameraViewLayoutChangeHandler}
			onOutputOrientationChanged={solution.cameraOrientationChangedHandler}
			androidPreviewViewType="surface-view"
		/>
	);
};

// react-native-mediapipe's stock camera deliberately targets the best camera
// format and enables photo output. The Android path uses a measured device
// profile instead, while high-end phones retain the existing 720p stream.
const PoseCamera = (props: PoseCameraProps) => {
	if (Platform.OS === 'android') return <AndroidPoseCamera {...props} />;
	const { performanceTier: _performanceTier, ...cameraProps } = props;
	return <MediapipeCamera {...cameraProps} />;
};

export default PoseCamera;
