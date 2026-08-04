import { SquatDetector } from '../SquatDetector';
import type { SquatMetrics } from '../squatMetrics';

function frame(kneeAngle: number, pelvisY = 400, ankleY = 500): SquatMetrics {
	return {
		kneeAngle,
		stanceWidth: 1.3,
		pelvisY,
		ankleY,
		leftAnkleY: ankleY,
		rightAnkleY: ankleY,
		leftAnkleX: 100,
		rightAnkleX: 230,
		shoulderWidth: 100,
		torsoLean: 8,
	};
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

	it('does not credit foot landmark drift as a Jump Squat without a landing', () => {
		const detector = new SquatDetector();
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.update(frame(105, 420, 520), 600);
		const returnToTop = detector.update(frame(170, 300, 460), 1_100);
		const later = detector.update(frame(170, 300, 460), 2_600);

		// One transient foot rise never reaches the two-frame airborne
		// confirmation, so the normal squat is credited as soon as the athlete
		// returns to the top instead of waiting for a fictitious landing.
		expect(returnToTop.rep).toEqual({ variant: 'standard', totalReps: 1 });
		expect(later.rep).toBeUndefined();
	});

	it('credits a squat with clear airborne foot lift as a Jump Squat', () => {
		const detector = new SquatDetector('jump');
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.update(frame(140, 360, 500), 700);
		detector.update(frame(150, 250, 480), 800);
		detector.update(frame(150, 250, 480), 850); // confirm airborne lift
		detector.update(frame(150, 330, 500), 900);
		detector.update(frame(150, 330, 500), 950); // confirm landing
		const update = detector.update(frame(170, 300, 500), 1_050);

		expect(update.rep).toEqual({ variant: 'jump', totalReps: 1 });
		expect(update.repCounts.jump).toBe(1);
	});

	it('keeps a regular squat state through a brief landmark dropout', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(170, 300), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.gap(650);
		const update = detector.update(frame(170, 300, 500), 1_100);

		expect(update.rep).toEqual({ variant: 'standard', totalReps: 1 });
	});

	it('does not count a normal squat in Jump Squats mode', () => {
		const detector = new SquatDetector('jump');
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(105, 420, 520), 500);
		const update = detector.update(frame(170, 300, 500), 1_100);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts).toEqual({ standard: 0, jump: 0, pulse: 0 });
	});

	it('does not count a confirmed jump in regular Squats mode', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(105, 420, 520), 500);
		detector.update(frame(140, 360, 500), 700);
		detector.update(frame(150, 250, 480), 800);
		detector.update(frame(150, 330, 500), 900);
		const update = detector.update(frame(170, 300, 500), 1_050);

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
