import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { MediapipeCamera } from 'react-native-mediapipe';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';

import { ANDROID_CAMERA_FORMAT, ANDROID_CAMERA_FPS } from '../../performanceProfile';

type PoseCameraProps = React.ComponentProps<typeof MediapipeCamera>;

const AndroidPoseCamera = ({
	style,
	solution,
	activeCamera = 'front',
	resizeMode = 'cover',
}: PoseCameraProps) => {
	const device = useCameraDevice(activeCamera);
	const format = useCameraFormat(device, [
		{ videoResolution: ANDROID_CAMERA_FORMAT },
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
// format and enables photo output. That is useful for a general-purpose demo,
// but it creates unnecessary work in a live Android exercise screen.
const PoseCamera = (props: PoseCameraProps) => {
	if (Platform.OS === 'android') return <AndroidPoseCamera {...props} />;
	return <MediapipeCamera {...props} />;
};

export default PoseCamera;
