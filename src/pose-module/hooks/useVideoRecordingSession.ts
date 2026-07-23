import { useCallback, useRef, useState } from 'react';

import { withTimeout } from '@/src/helpers/promiseTimeout';
import {
	isScreenRecordingAvailable,
	startScreenRecording,
	stopScreenRecording,
} from '@/src/helpers/screenRecorder';
import type { PyramidCameraHandle } from '@/src/components/pushup-pyramid/PyramidCamera';

// Bounds how long finalizeRecording() waits for the native stop-and-save
// promise (screen capture or camera fallback) before giving up. Without this,
// a native module that never settles (observed on some Android devices) left
// Save/Share buttons disabled or spinning forever with no recovery.
const STOP_TIMEOUT_MS = 8000;

export type RecordingKind = 'none' | 'screen' | 'camera';

/**
 * Shared recording bootstrap/teardown for the AI Push-Up Trainer screens
 * (Pyramid + the simple recorder). Both screens need the same screen-capture
 * vs. camera-fallback dance, and both need the same defensive timeout so a
 * stuck native promise can never hang the UI indefinitely — extracted here so
 * a fix to this logic applies to both screens at once.
 */
export function useVideoRecordingSession(cameraRef: React.RefObject<PyramidCameraHandle | null>) {
	const recordingKindRef = useRef<RecordingKind>('none');
	const [recordingKind, setRecordingKindState] = useState<RecordingKind>('none');
	const cameraResultRef = useRef<{ resolve: (path: string | null) => void } | null>(null);

	const setRecordingKind = useCallback((kind: RecordingKind) => {
		recordingKindRef.current = kind;
		setRecordingKindState(kind);
	}, []);

	const needsCameraVideo = !isScreenRecordingAvailable();

	const beginRecording = useCallback(
		async (withMic: boolean): Promise<RecordingKind> => {
			if (isScreenRecordingAvailable()) {
				const started = await startScreenRecording(withMic);
				if (!started) {
					setRecordingKind('none');
					return 'none';
				}
				setRecordingKind('screen');
				return 'screen';
			}

			setRecordingKind('camera');
			cameraRef.current?.startRecording();
			return 'camera';
		},
		[cameraRef, setRecordingKind],
	);

	// Bridges PyramidCamera's callback-based recording result into the same
	// Promise<string|null> shape the screen-capture path already returns.
	const handleCameraRecordingFinished = useCallback((path: string) => {
		cameraResultRef.current?.resolve(path);
		cameraResultRef.current = null;
	}, []);

	const handleCameraRecordingError = useCallback((_message: string) => {
		cameraResultRef.current?.resolve(null);
		cameraResultRef.current = null;
	}, []);

	const finalizeRecording = useCallback(async (): Promise<string | null> => {
		const kind = recordingKindRef.current;
		setRecordingKind('none');

		if (kind === 'none') {
			return null;
		}

		if (kind === 'screen') {
			return withTimeout(stopScreenRecording(), STOP_TIMEOUT_MS, null);
		}

		const cameraResult = new Promise<string | null>(resolve => {
			cameraResultRef.current = { resolve };
		});
		void cameraRef.current?.stopRecording().catch(() => undefined);
		return withTimeout(cameraResult, STOP_TIMEOUT_MS, null);
	}, [cameraRef, setRecordingKind]);

	const cancelRecording = useCallback(() => {
		const kind = recordingKindRef.current;
		setRecordingKind('none');
		if (kind === 'screen') {
			void stopScreenRecording().catch(() => undefined);
		} else if (kind === 'camera') {
			void cameraRef.current?.stopRecording().catch(() => undefined);
		}
	}, [cameraRef, setRecordingKind]);

	return {
		recordingKind,
		needsCameraVideo,
		beginRecording,
		finalizeRecording,
		cancelRecording,
		handleCameraRecordingFinished,
		handleCameraRecordingError,
	};
}
