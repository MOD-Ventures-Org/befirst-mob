import { SquatDetector } from '../SquatDetector';
import type { SquatMetrics } from '../squatMetrics';

function frame(
	kneeAngle: number,
	pelvisY = 400,
	leftFootY = 500,
	rightFootY = leftFootY,
	leftFootConfidence = 1,
	rightFootConfidence = 1,
): SquatMetrics {
	return {
		kneeAngle,
		stanceWidth: 1.3,
		pelvisY,
		ankleY: (leftFootY + rightFootY) / 2,
		leftAnkleY: leftFootY,
		rightAnkleY: rightFootY,
		leftAnkleX: 100,
		rightAnkleX: 230,
		shoulderWidth: 100,
		torsoLean: 8,
		leftFootY,
		rightFootY,
		leftFootConfidence,
		rightFootConfidence,
	};
}

function calibrateJumpDetector(detector: SquatDetector): void {
	detector.update(frame(170, 300, 500), 0);
	detector.update(frame(170, 300, 500), 300);
	detector.update(frame(170, 300, 500), 600);
}

describe('SquatDetector', () => {
	it('credits a full regular squat after a top-bottom-top movement', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(170, 300), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.update(frame(105, 420, 520), 600);
		const update = detector.update(frame(170, 300, 500), 1_100);

		expect(update.rep).toEqual({ variant: 'standard', totalReps: 1 });
		expect(update.repCounts).toEqual({ standard: 1, jump: 0, pulse: 0 });
	});

	it('credits a shallow phone-facing squat after a top-bottom-top movement', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(152, 300), 0);
		detector.update(frame(140, 400, 520), 500);
		const update = detector.update(frame(152, 300, 500), 1_100);

		expect(update.rep).toEqual({ variant: 'standard', totalReps: 1 });
	});

	it('does not count a partial descent that remains above the shallow bottom threshold', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(152, 300), 0);
		detector.update(frame(141, 390, 515), 500);
		const update = detector.update(frame(152, 300, 500), 1_100);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
	});

	it('does not arm or count a kneeling or plank-like movement as a normal squat', () => {
		const detector = new SquatDetector('standard');
		detector.update({ ...frame(140, 420, 520), isUpright: false }, 0);
		detector.update({ ...frame(152, 300, 500), isUpright: false }, 500);
		const update = detector.update(frame(152, 300, 500), 1_100);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
		expect(update.status).toBe('Lower into your squat');
	});

	it('does not count a normal squat in Jump Squats mode', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		const update = detector.update(frame(170, 300, 500), 1_100);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts).toEqual({ standard: 0, jump: 0, pulse: 0 });
	});

	it('ignores one-foot jitter without matching hip rise', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(128, 420, 480, 520), 1_000);
		const update = detector.update(frame(170, 300, 500), 1_200);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.jump).toBe(0);
	});

	it('does not classify a small rise out of the squat as a jump', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(145, 350, 490), 900);
		const partialRise = detector.update(frame(150, 330, 485), 1_000);

		expect(partialRise.rep).toBeUndefined();
		expect(partialRise.jumpDiagnostics?.state).not.toBe('airborne');
	});

	it('credits a clear Jump Squat on the first verified downward arc', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(128, 380, 510), 900);
		detector.update(frame(152, 260, 480), 1_000); // takeoff starts at phone-facing top angle
		const airborne = detector.update(frame(152, 230, 470), 1_100); // 100 ms airborne confirmation
		const descent = detector.update(frame(152, 280, 490), 1_200); // descending arc verifies the jump
		const landing = detector.update(frame(152, 330, 500), 1_300);

		expect(airborne.rep).toBeUndefined();
		expect(descent.rep).toEqual({ variant: 'jump', totalReps: 1 });
		expect(landing.repCounts.jump).toBe(1);
	});

	it('keeps the jump baseline briefly after standing so late peak lift can arm takeoff', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		const firstTopFrame = detector.update(frame(152, 310, 495), 1_000); // not lifted enough yet
		detector.update(frame(152, 250, 480), 1_120); // peak lift arrives after knee extension
		const airborne = detector.update(frame(152, 230, 470), 1_220);
		const descent = detector.update(frame(152, 280, 490), 1_320);
		const landing = detector.update(frame(152, 330, 500), 1_420);

		expect(firstTopFrame.jumpDiagnostics?.state).toBe('armed');
		expect(airborne.jumpDiagnostics?.state).toBe('airborne');
		expect(descent.rep).toEqual({ variant: 'jump', totalReps: 1 });
		expect(landing.repCounts.jump).toBe(1);
	});

	it('uses timestamps, not frame counts, when inference is slow or frames are dropped', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(166, 260, 480), 1_000); // takeoff begins
		const airborne = detector.update(frame(166, 220, 470), 1_200); // 200 ms later: airborne
		const descent = detector.update(frame(166, 280, 490), 1_400); // descent begins
		const landing = detector.update(frame(152, 330, 500), 1_600); // 200 ms later: confirmed

		expect(airborne.rep).toBeUndefined();
		expect(descent.rep).toEqual({ variant: 'jump', totalReps: 1 });
		expect(landing.repCounts.jump).toBe(1);
	});

	it('holds an airborne event through a short landmark dropout', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(166, 260, 480), 1_000);
		const airborne = detector.update(frame(166, 230, 470), 1_100); // airborne
		detector.gap(1_280); // 180 ms: inside the 250 ms jump tracking allowance
		const descent = detector.update(frame(166, 280, 490), 1_300);
		const landing = detector.update(frame(152, 330, 500), 1_400);

		expect(airborne.rep).toBeUndefined();
		expect(descent.rep).toEqual({ variant: 'jump', totalReps: 1 });
		expect(landing.repCounts.jump).toBe(1);
	});

	it('does not count an unverified jump when landing landmarks stay lost', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(166, 260, 480), 1_000);
		detector.update(frame(166, 230, 470), 1_100);
		const update = detector.gap(1_401);

		expect(update.repCounts.jump).toBe(0);
		expect(update.status).toContain('Feet lost during jump');
	});

	it('does not turn a regular squat ascent with foot drift into a Jump Squat', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(166, 260, 480), 1_000); // apparent takeoff begins
		const airborne = detector.update(frame(166, 230, 470), 1_100); // may satisfy lift evidence
		const settledAtTop = detector.update(frame(170, 300, 470), 1_300); // no fall from the apparent peak
		const timeout = detector.update(frame(170, 300, 470), 3_000);

		expect(airborne.rep).toBeUndefined();
		expect(settledAtTop.rep).toBeUndefined();
		expect(timeout.repCounts.jump).toBe(0);
		expect(timeout.jumpDiagnostics?.state).toBe('ready');
	});

	it('counts the first jump when a replay starts at squat bottom', () => {
		const detector = new SquatDetector('jump');
		const bottom = detector.update(frame(125, 420, 520), 0);
		detector.update(frame(152, 330, 505), 200);
		const airborne = detector.update(frame(158, 280, 500), 280);
		const descent = detector.update(frame(158, 340, 515), 450);

		expect(bottom.jumpDiagnostics?.state).toBe('armed');
		expect(airborne.jumpDiagnostics?.state).toBe('airborne');
		expect(descent.rep).toEqual({ variant: 'jump', totalReps: 1 });
	});

	it('counts a modest but real jump instead of requiring a very high leap', () => {
		const detector = new SquatDetector('jump');
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(125, 420, 520), 300);
		detector.update(frame(152, 290, 490), 500);
		detector.update(frame(158, 275, 487), 570);
		const descent = detector.update(frame(158, 325, 498), 700);

		expect(descent.rep).toEqual({ variant: 'jump', totalReps: 1 });
	});

	it('counts a low jump after a shallow loading squat', () => {
		const detector = new SquatDetector('jump');
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(142, 390, 505), 300); // natural loading dip, not a deep squat
		detector.update(frame(150, 292, 495), 500); // five percent of shoulder width off the ground
		const airborne = detector.update(frame(155, 288, 494), 560);
		const descent = detector.update(frame(150, 305, 498), 650);

		expect(airborne.jumpDiagnostics?.state).toBe('airborne');
		expect(descent.rep).toEqual({ variant: 'jump', totalReps: 1 });
	});

	it('counts consecutive low jump squats without a standing pause', () => {
		const detector = new SquatDetector('jump');
		detector.update(frame(170, 300, 500), 0);

		// First repetition.
		detector.update(frame(142, 390, 505), 300);
		detector.update(frame(150, 292, 495), 500);
		detector.update(frame(155, 288, 494), 560);
		const firstDescent = detector.update(frame(150, 305, 498), 650);

		// Land directly into the next loading dip and jump again. There is no
		// standing/settled frame between repetitions.
		detector.update(frame(142, 390, 505), 700);
		detector.update(frame(150, 292, 495), 820);
		detector.update(frame(155, 288, 494), 880);
		const secondDescent = detector.update(frame(150, 305, 498), 970);

		expect(firstDescent.rep).toEqual({ variant: 'jump', totalReps: 1 });
		expect(secondDescent.rep).toEqual({ variant: 'jump', totalReps: 2 });
		expect(secondDescent.repCounts.jump).toBe(2);
	});

	it('counts a side-view jump when the rear foot is occluded', () => {
		const detector = new SquatDetector('jump');
		detector.update(frame(170, 300, 500, 500, 0.95, 0.12), 0);
		detector.update(frame(125, 420, 520, 520, 0.95, 0.12), 300);
		detector.update(frame(152, 285, 484, 515, 0.95, 0.12), 500);
		detector.update(frame(158, 265, 480, 518, 0.95, 0.12), 570);
		const descent = detector.update(frame(158, 330, 495, 520, 0.95, 0.12), 720);

		expect(descent.rep).toEqual({ variant: 'jump', totalReps: 1 });
	});

	it('keeps an athletic forward torso lean armed in Jump Squat mode', () => {
		const detector = new SquatDetector('jump');
		detector.update({ ...frame(170, 300, 500), torsoLean: 55 }, 0);
		const bottom = detector.update({ ...frame(125, 420, 520), torsoLean: 60 }, 300);

		expect(bottom.jumpDiagnostics?.state).toBe('armed');
		expect(bottom.status).toBe('Drive up and leave the floor');
	});

	it('does not count a normal squat with small two-foot landmark drift', () => {
		const detector = new SquatDetector('jump');
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(125, 420, 520), 300);
		detector.update(frame(152, 320, 494), 500);
		detector.update(frame(170, 300, 493), 570);
		const settled = detector.update(frame(170, 300, 500), 720);

		expect(settled.repCounts.jump).toBe(0);
		expect(settled.rep).toBeUndefined();
	});

	it('keeps a regular squat state through a brief landmark dropout', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(170, 300), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.gap(650);
		const update = detector.update(frame(170, 300, 500), 1_100);

		expect(update.rep).toEqual({ variant: 'standard', totalReps: 1 });
	});

	it('does not count a confirmed jump in regular Squats mode', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(128, 420, 520), 500);
		detector.update(frame(166, 260, 480), 700);
		detector.update(frame(166, 230, 470), 800);
		detector.update(frame(166, 280, 490), 900);
		const update = detector.update(frame(152, 330, 500), 1_000);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts).toEqual({ standard: 0, jump: 0, pulse: 0 });
	});

	it('counts a controlled bottom-range return as a pulse', () => {
		const detector = new SquatDetector();
		detector.update(frame(170, 300), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.update(frame(145, 385, 515), 800);
		const update = detector.update(frame(105, 420, 520), 1_100);

		expect(update.rep).toEqual({ variant: 'pulse', totalReps: 1 });
		expect(update.repCounts).toEqual({ standard: 0, jump: 0, pulse: 1 });
	});

	it('shows and saves a settled bottom hold', () => {
		const detector = new SquatDetector();
		detector.update(frame(170, 300), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.update(frame(105, 420, 520), 600);
		const live = detector.update(frame(105, 420, 520), 1_450);
		const completed = detector.finish(1_800);

		expect(live.activeHold).toMatchObject({ variant: 'standard', position: 'bottom' });
		expect(live.activeHold?.durationMs).toBe(850);
		expect(completed.completedHold).toMatchObject({ variant: 'standard', position: 'bottom', durationMs: 850 });
		expect(completed.holds).toHaveLength(1);
	});
});
