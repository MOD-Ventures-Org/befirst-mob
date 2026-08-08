import { SquatDetector } from '../SquatDetector';
import type { SquatMetrics } from '../squatMetrics';

function frame(
	kneeAngle: number,
	pelvisY = 400,
	leftFootY = 500,
	rightFootY = leftFootY,
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

	it('credits a controlled phone-facing squat without requiring a deep 2-D knee bend', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(152, 300), 0);
		detector.update(frame(130, 400, 520), 500);
		const update = detector.update(frame(152, 300, 500), 1_100);

		expect(update.rep).toEqual({ variant: 'standard', totalReps: 1 });
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

	it('credits a clear Jump Squat after calibrated takeoff and landing windows', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(128, 380, 510), 900);
		detector.update(frame(128, 260, 480), 1_000); // takeoff starts
		detector.update(frame(145, 230, 470), 1_100); // 100 ms airborne confirmation
		detector.update(frame(145, 330, 500), 1_200); // landing starts
		const landing = detector.update(frame(152, 330, 500), 1_300); // 100 ms landing confirmation

		expect(landing.rep).toEqual({ variant: 'jump', totalReps: 1 });
		expect(landing.repCounts.jump).toBe(1);
	});

	it('uses timestamps, not frame counts, when inference is slow or frames are dropped', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(128, 260, 480), 1_000); // takeoff begins
		detector.update(frame(145, 220, 470), 1_200); // 200 ms later: airborne
		detector.update(frame(145, 330, 500), 1_400); // landing begins
		const landing = detector.update(frame(152, 330, 500), 1_600); // 200 ms landed

		expect(landing.rep).toEqual({ variant: 'jump', totalReps: 1 });
	});

	it('holds an airborne event through a short landmark dropout', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(128, 260, 480), 1_000);
		detector.update(frame(145, 230, 470), 1_100); // airborne
		detector.gap(1_280); // 180 ms: inside the 250 ms jump tracking allowance
		detector.update(frame(145, 330, 500), 1_300);
		const landing = detector.update(frame(152, 330, 500), 1_400);

		expect(landing.rep).toEqual({ variant: 'jump', totalReps: 1 });
	});

	it('clears an incomplete airborne event after a longer foot-tracking gap', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(128, 260, 480), 1_000);
		detector.update(frame(145, 230, 470), 1_100);
		const update = detector.gap(1_400);

		expect(update.repCounts.jump).toBe(0);
		expect(update.status).toContain('Feet lost during jump');
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
		detector.update(frame(128, 260, 480), 700);
		detector.update(frame(145, 230, 470), 800);
		detector.update(frame(145, 330, 500), 900);
		const update = detector.update(frame(152, 330, 500), 1_000);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts).toEqual({ standard: 0, jump: 0, pulse: 0 });
	});

	it('counts a controlled bottom-range return as a pulse', () => {
		const detector = new SquatDetector();
		detector.update(frame(170, 300), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.update(frame(140, 385, 515), 800);
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
