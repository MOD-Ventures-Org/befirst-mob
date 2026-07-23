import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';

const TRACK_WIDTH = 22;
const TRACK_HEIGHT = 336;
const TRACK_BORDER = 1.6;
const GRADIENT_WIDTH = TRACK_WIDTH - TRACK_BORDER * 2;
const GRADIENT_HEIGHT = TRACK_HEIGHT - TRACK_BORDER * 2;

export interface DepthBarProps {
	// Normalized rep position from the pose pipeline: 1 = top (arms extended),
	// 0 = bottom of the push-up.
	position: SharedValue<number>;
	testID?: string;
}

/**
 * Live push-up depth gauge for the AI trainer HUD. The fill grows top-down as
 * the athlete descends.
 *
 * The reveal is two counter-transforms rather than an animated height: the clip
 * window slides up by the unfilled amount and the gradient slides back down by
 * the same amount, so the visible band is always the top `1 - position` of a
 * gradient that never moves on screen. Transform-only keeps it off the layout
 * pass and off React state (see docs/harness/mobile-ui/reanimated.md).
 *
 * Note: `position` holds its initial value until the rep detector calibrates on
 * the first full-range rep, so the bar reads empty before then.
 */
export function DepthBar({ position, testID }: DepthBarProps) {
	const clipStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: -position.value * GRADIENT_HEIGHT }],
	}));

	const gradientStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: position.value * GRADIENT_HEIGHT }],
	}));

	return (
		<View testID={testID} style={styles.container} pointerEvents="none">
			<Text style={styles.label}>DEPTH</Text>
			<View style={styles.track}>
				<Animated.View style={[styles.clip, clipStyle]}>
					<Animated.View style={gradientStyle}>
						<Canvas style={styles.gradient}>
							<Rect x={0} y={0} width={GRADIENT_WIDTH} height={GRADIENT_HEIGHT}>
								<LinearGradient
									start={vec(GRADIENT_WIDTH / 2, 0)}
									end={vec(GRADIENT_WIDTH / 2, GRADIENT_HEIGHT)}
									colors={['#B4EC3C', '#F5D33C', '#F7941D', '#F4472F']}
								/>
							</Rect>
						</Canvas>
					</Animated.View>
				</Animated.View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		alignItems: 'center',
		gap: 4,
	},
	label: {
		color: '#fff',
		fontSize: 10,
		fontWeight: '600',
		letterSpacing: -0.21,
		textTransform: 'uppercase',
	},
	track: {
		width: TRACK_WIDTH,
		height: TRACK_HEIGHT,
		borderRadius: 28,
		borderWidth: TRACK_BORDER,
		borderColor: '#999',
		backgroundColor: 'rgba(255,255,255,0.2)',
		overflow: 'hidden',
	},
	clip: {
		height: GRADIENT_HEIGHT,
		overflow: 'hidden',
	},
	gradient: {
		width: GRADIENT_WIDTH,
		height: GRADIENT_HEIGHT,
	},
});
