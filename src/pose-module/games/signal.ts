import type { SharedValue } from 'react-native-reanimated';

/**
 * The contract between the push-up CV engine and the mini-games. Games are
 * renderers, never detectors: they consume these shared values (written per
 * processed camera frame by usePoseSession) plus the discrete `onRep` event,
 * and never touch camera frames, pose models, or counting logic.
 *
 * Caveats games must handle:
 * - `position` holds its last value whenever the engine cannot produce one
 *   (detection dropout, upright veto, traveling hands) and starts at 1.0 (top)
 *   until the first rep calibrates the depth envelope.
 * - Pose detection runs at ~10-25 fps while games render at 60+; consumers
 *   must smooth/interpolate (time-corrected EMA) on the UI thread and never
 *   bind raw `position` straight to a sprite.
 * - Pause gameplay when `personDetected` is false or `confidence` stays below
 *   0.5 for more than a second — never fail the player on detection loss.
 */
export interface PushUpSignal {
	/** Normalized body height: 0 = bottom of the push-up, 1 = top. */
	position: SharedValue<number>;
	/** Mean per-frame landmark visibility, 0 when no subject is tracked. */
	confidence: SharedValue<number>;
	/** False while no (locked) person is in frame. */
	personDetected: SharedValue<boolean>;
	/**
	 * False when the wrists are moving fast enough to read as lifted off the
	 * floor (same signal that vetoes rep counting). The model has no notion of
	 * the floor itself, so this is a wrist-motion proxy: reliable for "hands
	 * lifted/moved", not a literal contact check. Games may warn on it.
	 */
	palmsPlanted: SharedValue<boolean>;
}
