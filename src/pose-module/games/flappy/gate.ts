// Pure per-frame gate resolution for Flappy Push. Worklet-safe and jest-tested
// — the frame loop calls this with plain numbers only.

export interface FlappyGeom {
	bandW: number;
	bandH: number;
	playTop: number;
	playH: number;
	pipeW: number;
	planeX: number;
	planeW: number;
	planeH: number;
	coinR: number;
}

export interface GateFrameEvents {
	hitNow: boolean;
	coinNow: boolean;
	passedNow: boolean;
}

export function computeFlappyGeom(
	bandW: number,
	bandH: number,
	fractions: {
		PLAY_MARGIN_FRAC: number;
		PLANE_X_FRAC: number;
		PIPE_W_FRAC: number;
		PLANE_W_FRAC: number;
		PLANE_H_FRAC: number;
		COIN_R_FRAC: number;
	},
): FlappyGeom {
	const playTop = bandH * fractions.PLAY_MARGIN_FRAC;
	return {
		bandW,
		bandH,
		playTop,
		playH: bandH * (1 - fractions.PLAY_MARGIN_FRAC * 2),
		pipeW: bandW * fractions.PIPE_W_FRAC,
		planeX: bandW * fractions.PLANE_X_FRAC,
		planeW: bandW * fractions.PLANE_W_FRAC,
		planeH: bandH * fractions.PLANE_H_FRAC,
		coinR: bandH * fractions.COIN_R_FRAC,
	};
}

/** Y of the bottom edge of the ceiling pipe for a slot. */
export function topPipeBottomY(topFrac: number, geom: FlappyGeom): number {
	'worklet';
	return geom.playTop + topFrac * geom.playH;
}

/** Y of the top edge of the floor pipe for a slot. */
export function bottomPipeTopY(bottomFrac: number, geom: FlappyGeom): number {
	'worklet';
	return geom.playTop + geom.playH - bottomFrac * geom.playH;
}

/**
 * Resolves one frame of the active gate: whether the plane collides with a
 * pipe, crosses the coin at the gap center, or has fully passed the gate.
 * `alreadyHit` suppresses re-collisions; coin pickup requires a clean gate.
 */
export function resolveGateFrame(
	planeY: number,
	gateScreenX: number,
	topFrac: number,
	bottomFrac: number,
	geom: FlappyGeom,
	alreadyHit: boolean,
	alreadyTookCoin: boolean,
): GateFrameEvents {
	'worklet';
	const planeLeft = geom.planeX - geom.planeW / 2;
	const planeRight = geom.planeX + geom.planeW / 2;
	const planeTop = planeY - geom.planeH / 2;
	const planeBottom = planeY + geom.planeH / 2;

	const overlapX = planeRight > gateScreenX && planeLeft < gateScreenX + geom.pipeW;
	const topBottom = topPipeBottomY(topFrac, geom);
	const bottomTop = bottomPipeTopY(bottomFrac, geom);

	const hitNow =
		!alreadyHit && overlapX && (topFrac > 0 && planeTop < topBottom || bottomFrac > 0 && planeBottom > bottomTop);

	const coinX = gateScreenX + geom.pipeW / 2;
	const gapCenterY = (topBottom + bottomTop) / 2;
	const coinNow =
		!alreadyTookCoin &&
		!alreadyHit &&
		!hitNow &&
		Math.abs(geom.planeX - coinX) < geom.coinR + geom.planeW / 2 &&
		Math.abs(planeY - gapCenterY) < geom.coinR + geom.planeH / 2;

	const passedNow = gateScreenX + geom.pipeW < planeLeft;

	return { hitNow, coinNow, passedNow };
}
