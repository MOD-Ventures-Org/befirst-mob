// ============================================================================
// FLAPPY PUSH LEVEL FORMAT — edit LEVEL_1 below to tune the game.
//
// The level is a comma (or newline) separated list of SLOTS. The world
// scrolls through them left to right. Every slot — including empty ones — is
// exactly TWO pipe-widths wide, so the distance between obstacles is simply
// the number of 0s you put between them.
//
//   0        nothing (one empty slot)
//   3-down   pipe standing on the floor, 3/10 of the playable height tall
//   7-top    pipe hanging from the ceiling, 7/10 of the playable height long
//
// Heights go from 1 to 8 (8 = 80% of the playable height, always leaving a
// gap to fly through). A coin sits in the gap of every pipe slot; +1 point
// for passing a pipe, +2 for taking its coin. Example:
//
//   0,0,0,0,0,0,3-down,0,0,0,0,0,7-top,0,0,0,4-down
//
// ============================================================================

export interface FlappyLevel {
	/** Ceiling-pipe length per slot, fraction of the playable height (0 = none). */
	topFrac: number[];
	/** Floor-pipe height per slot, fraction of the playable height (0 = none). */
	bottomFrac: number[];
	/** Whether the slot contains a pipe (scoring/coins only apply to these). */
	hasPipe: boolean[];
}

const MAX_HEIGHT = 8;
const TOKEN_PATTERN = /^(\d)-(top|down)$/;

export function parseFlappyLevel(source: string): FlappyLevel {
	const topFrac: number[] = [];
	const bottomFrac: number[] = [];
	const hasPipe: boolean[] = [];

	// Lines starting with # are comments — product-authored level files carry
	// the format doc inline.
	const withoutComments = source
		.split('\n')
		.filter(line => !line.trim().startsWith('#'))
		.join('\n');

	const tokens = withoutComments
		.split(/[\s,]+/)
		.map(token => token.trim())
		.filter(token => token.length > 0);

	tokens.forEach((token, index) => {
		const slotNo = index + 1;

		if (token === '0') {
			topFrac.push(0);
			bottomFrac.push(0);
			hasPipe.push(false);
			return;
		}

		const match = TOKEN_PATTERN.exec(token);
		if (!match) {
			throw new Error(
				`Flappy level slot ${slotNo}: expected "0", "<1-${MAX_HEIGHT}>-down" or "<1-${MAX_HEIGHT}>-top", got "${token}"`,
			);
		}
		const height = Number(match[1]);
		if (height < 1 || height > MAX_HEIGHT) {
			throw new Error(`Flappy level slot ${slotNo}: height must be 1-${MAX_HEIGHT}, got "${token}"`);
		}

		if (match[2] === 'top') {
			topFrac.push(height / 10);
			bottomFrac.push(0);
		} else {
			topFrac.push(0);
			bottomFrac.push(height / 10);
		}
		hasPipe.push(true);
	});

	return { topFrac, bottomFrac, hasPipe };
}

// The default level. Product-editable — see the format doc above.
export const LEVEL_1 = `
0,0,0,
3-down,0,0,0,
4-top,0,0,0,
2-down,0,0,
5-top,0,0,0,
5-down,0,0,
7-top,0,0,0,
3-down,0,
6-top,0,0,0,
8-down,0,0,
4-down,0,
7-top,0,0,0,
5-down,0,
8-top,0,0,
6-down,0,0,0
`;
