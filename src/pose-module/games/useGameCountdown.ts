import { useCallback, useRef } from 'react';

import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { FLAPPY_TIMING } from './flappy/flappyConfig';

const T = FLAPPY_TIMING;

/**
 * The games' shared 3-2-1-GO pre-start countdown, clocked on the UI thread
 * (frame callback) so camera-load JS timer starvation can never stretch the
 * beats: "3" at 0 s, "2" at 2 s, "1" at 4 s, GO (beat 0) at 5 s.
 */
export function useGameCountdown(onBeat: (beat: number) => void): { start: () => void; cancel: () => void } {
	const active = useSharedValue(false);
	const startTs = useSharedValue(0);
	const current = useSharedValue(-1);

	const onBeatRef = useRef(onBeat);
	onBeatRef.current = onBeat;
	const emit = useCallback((beat: number) => {
		onBeatRef.current(beat);
	}, []);

	useFrameCallback(frameInfo => {
		'worklet';
		if (!active.value) return;
		if (startTs.value === 0) startTs.value = frameInfo.timestamp;
		const elapsed = frameInfo.timestamp - startTs.value;
		const beat =
			elapsed < T.COUNTDOWN_2_AT_MS ? 3 : elapsed < T.COUNTDOWN_1_AT_MS ? 2 : elapsed < T.COUNTDOWN_GO_AT_MS ? 1 : 0;
		if (beat !== current.value) {
			current.value = beat;
			scheduleOnRN(emit, beat);
			if (beat === 0) active.value = false;
		}
	});

	const start = useCallback(() => {
		current.value = -1;
		startTs.value = 0;
		active.value = true;
	}, [active, startTs, current]);

	const cancel = useCallback(() => {
		active.value = false;
	}, [active]);

	return { start, cancel };
}
