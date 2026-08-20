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
		leftKneeAngle: kneeAngle,
		rightKneeAngle: kneeAngle,
		stanceWidth: 1.3,
		pelvisX: 165,
		pelvisY,
		leftHipY: pelvisY,
		rightHipY: pelvisY,
		ankleY: (leftFootY + rightFootY) / 2,
		leftAnkleY: leftFootY,
		rightAnkleY: rightFootY,
		leftAnkleX: 100,
		rightAnkleX: 230,
		leftFootX: 100,
		rightFootX: 230,
		shoulderWidth: 100,
		torsoLean: 8,
		leftFootY,
		rightFootY,
		leftFootConfidence,
		rightFootConfidence,
	};
}

function translate(source: SquatMetrics, deltaX: number, deltaY: number): SquatMetrics {
	const leftFootY = (source.leftFootY ?? source.leftAnkleY) + deltaY;
	const rightFootY = (source.rightFootY ?? source.rightAnkleY) + deltaY;
	return {
		...source,
		pelvisX: (source.pelvisX ?? (source.leftAnkleX + source.rightAnkleX) / 2) + deltaX,
		pelvisY: source.pelvisY + deltaY,
		leftHipY: (source.leftHipY ?? source.pelvisY) + deltaY,
		rightHipY: (source.rightHipY ?? source.pelvisY) + deltaY,
		ankleY: (leftFootY + rightFootY) / 2,
		leftAnkleY: source.leftAnkleY + deltaY,
		rightAnkleY: source.rightAnkleY + deltaY,
		leftAnkleX: source.leftAnkleX + deltaX,
		rightAnkleX: source.rightAnkleX + deltaX,
		leftFootY,
		rightFootY,
		leftFootX: (source.leftFootX ?? source.leftAnkleX) + deltaX,
		rightFootX: (source.rightFootX ?? source.rightAnkleX) + deltaX,
	};
}

// Standard Squats deliberately require a settled standing reference before a
// descent can arm. Keep detector-level traces honest by supplying enough
// consecutive top samples for both the time and sample-count calibration gates.
function calibrateStandardDetector(
	detector: SquatDetector,
	startMs = 0,
	top: SquatMetrics = frame(170, 300, 500),
): number {
	for (let sample = 0; sample < 6; sample += 1) {
		detector.update(top, startMs + sample * 100);
	}
	return startMs + 500;
}

function completeAtStanding(
	detector: SquatDetector,
	startMs: number,
	top: SquatMetrics = frame(170, 300, 500),
): ReturnType<SquatDetector['update']> {
	detector.update(top, startMs);
	detector.update(top, startMs + 100);
	return detector.update(top, startMs + 200);
}

function calibrateJumpDetector(detector: SquatDetector): void {
	detector.update(frame(170, 300, 500), 0);
	detector.update(frame(170, 300, 500), 300);
	detector.update(frame(170, 300, 500), 600);
}

describe('SquatDetector', () => {
	it('credits a full regular squat after a top-bottom-top movement', () => {
		const detector = new SquatDetector('standard');
		calibrateStandardDetector(detector);
		const bottom = frame(105, 410, 510);
		detector.update(bottom, 600);
		detector.update(bottom, 700);
		detector.update(bottom, 800);
		const update = completeAtStanding(detector, 1_100);

		expect(update.rep).toEqual({ variant: 'standard', totalReps: 1 });
		expect(update.repCounts).toEqual({ standard: 1, jump: 0, pulse: 0 });
	});

	it('credits a shallow phone-facing squat after a top-bottom-top movement', () => {
		const detector = new SquatDetector('standard');
		const top = frame(152, 300, 500);
		calibrateStandardDetector(detector, 0, top);
		const bottom = frame(140, 400, 510);
		detector.update(bottom, 600);
		detector.update(bottom, 700);
		detector.update(bottom, 800);
		const update = completeAtStanding(detector, 1_100, top);

		expect(update.rep).toEqual({ variant: 'standard', totalReps: 1 });
	});

	it('uses a configured normal-squat bottom angle instead of the 140-degree default', () => {
		const detector = new SquatDetector('standard', { standardBottomKneeAngle: 125 });
		const top = frame(152, 300, 500);
		calibrateStandardDetector(detector, 0, top);
		// This descent is deeper than standing but remains above the configured
		// bottom, so it must not arm the cycle.
		detector.update(frame(130, 390, 510), 600);
		detector.update(frame(130, 390, 510), 700);
		detector.update(top, 800);
		const bottom = frame(125, 400, 510);
		detector.update(bottom, 1_000);
		detector.update(bottom, 1_100);
		detector.update(bottom, 1_200);
		const update = completeAtStanding(detector, 1_500, top);

		expect(update.rep).toEqual({ variant: 'standard', totalReps: 1 });
	});

	it('does not count a partial descent that remains above the shallow bottom threshold', () => {
		const detector = new SquatDetector('standard');
		const top = frame(152, 300, 500);
		calibrateStandardDetector(detector, 0, top);
		detector.update(frame(141, 390, 510), 600);
		detector.update(frame(141, 390, 510), 700);
		const update = completeAtStanding(detector, 900, top);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
	});

	it('ignores a standing one-leg raise even when the averaged knee angle looks deep', () => {
		const detector = new SquatDetector('standard');
		calibrateStandardDetector(detector);
		const oneLegUp = {
			...frame(125, 305, 445, 500),
			leftKneeAngle: 80,
			rightKneeAngle: 170,
		};
		const rejected = detector.update(oneLegUp, 600);
		detector.update(oneLegUp, 700);
		const update = completeAtStanding(detector, 900);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
		expect(rejected.status).toContain('rep cancelled');
	});

	it('ignores an asymmetric lunge-like bend instead of treating it as a squat', () => {
		const detector = new SquatDetector('standard');
		calibrateStandardDetector(detector);
		const lunge = {
			...frame(115, 400, 510),
			leftKneeAngle: 90,
			rightKneeAngle: 140,
		};
		detector.update(lunge, 600);
		detector.update(lunge, 700);
		detector.update(lunge, 800);
		const update = completeAtStanding(detector, 1_000);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
	});

	it('requires real pelvis descent instead of counting a bent-knee landmark glitch', () => {
		const detector = new SquatDetector('standard');
		calibrateStandardDetector(detector);
		detector.update(frame(120, 310, 500), 600);
		detector.update(frame(120, 310, 500), 700);
		detector.update(frame(120, 310, 500), 800);
		const update = completeAtStanding(detector, 1_000);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
	});

	it('requires the bottom signal to remain stable instead of arming on one bad frame', () => {
		const detector = new SquatDetector('standard');
		calibrateStandardDetector(detector);
		detector.update(frame(110, 410, 510), 600);
		const update = completeAtStanding(detector, 700);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
	});

	it('does not count when a foot lifts after a valid squat bottom', () => {
		const detector = new SquatDetector('standard');
		calibrateStandardDetector(detector);
		const bottom = frame(110, 410, 510);
		detector.update(bottom, 600);
		detector.update(bottom, 700);
		detector.update(bottom, 800);
		const lifted = detector.update(frame(170, 300, 450, 500), 900);
		const update = completeAtStanding(detector, 1_100);

		expect(lifted.status).toContain('rep cancelled');
		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
	});

	it('does not arm or count a kneeling or plank-like movement as a normal squat', () => {
		const detector = new SquatDetector('standard');
		detector.update({ ...frame(140, 420, 520), isUpright: false }, 0);
		detector.update({ ...frame(152, 300, 500), isUpright: false }, 100);
		calibrateStandardDetector(detector, 200, frame(152, 300, 500));
		const update = detector.update(frame(152, 300, 500), 800);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
		expect(update.status).toBe('Lower into your squat');
	});

	describe('standard squat adversarial traces', () => {
		it('cancels an armed squat after a long timestamp gap even when gap() was not called', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const bottom = frame(110, 410, 510);
			detector.update(bottom, 600);
			detector.update(bottom, 700);
			detector.update(bottom, 800);

			// Camera callbacks can arrive without an explicit null frame. A timestamp
			// discontinuity must be treated as tracking loss before this top is read.
			detector.update(frame(170, 300, 500), 1_800);
			const update = completeAtStanding(detector, 1_900);

			expect(update.rep).toBeUndefined();
			expect(update.repCounts.standard).toBe(0);
		});

		it('rejects rigid full-pose vertical translation as pelvis descent', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			// 0.21 shoulder widths used to satisfy both the 0.20 pelvis-drop
			// minimum and the 0.22 foot-travel maximum despite zero hip-to-foot
			// compression. The bent angles model an accompanying landmark glitch.
			const translated = translate(frame(110, 300, 500), 0, 21);
			detector.update(translated, 600);
			detector.update(translated, 700);
			detector.update(translated, 800);
			const update = completeAtStanding(detector, 1_000);

			expect(update.rep).toBeUndefined();
			expect(update.repCounts.standard).toBe(0);
		});

		it('rejects a laterally translated body even when both feet keep the same stance width', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			// Translating both feet together preserves stanceWidth. Absolute foot and
			// pelvis anchors must still cancel the partial movement as walking/exiting.
			const translatedBottom = translate(frame(110, 410, 510), 80, 0);
			detector.update(translatedBottom, 600);
			detector.update(translatedBottom, 700);
			detector.update(translatedBottom, 800);
			const update = completeAtStanding(detector, 1_000);

			expect(update.rep).toBeUndefined();
			expect(update.repCounts.standard).toBe(0);
		});

		it('rejects one-side-only hip-to-foot compression even when both knee angles look bent', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const oneSidedCompression: SquatMetrics = {
				...frame(110, 360, 510),
				leftHipY: 410,
				rightHipY: 310,
			};
			detector.update(oneSidedCompression, 600);
			detector.update(oneSidedCompression, 700);
			detector.update(oneSidedCompression, 800);
			const update = completeAtStanding(detector, 1_000);

			expect(update.rep).toBeUndefined();
			expect(update.repCounts.standard).toBe(0);
		});

		it('rejects bottom evidence when either knee angle is missing', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const missingKnee: SquatMetrics = {
				...frame(110, 410, 510),
				rightKneeAngle: undefined,
			};
			detector.update(missingKnee, 600);
			detector.update(missingKnee, 700);
			detector.update(missingKnee, 800);
			const update = completeAtStanding(detector, 1_000);

			expect(update.rep).toBeUndefined();
			expect(update.repCounts.standard).toBe(0);
		});

		it('does not confirm a phase from only two sparse qualifying samples', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const bottom = frame(110, 410, 510);
			detector.update(bottom, 600);
			detector.update(bottom, 700);
			const update = completeAtStanding(detector, 800);

			expect(update.rep).toBeUndefined();
			expect(update.repCounts.standard).toBe(0);
		});

		it('still credits a controlled bilateral squat after stable calibration', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const updates = [
				detector.update(frame(145, 330, 502), 600),
				detector.update(frame(135, 370, 505), 700),
				detector.update(frame(120, 400, 508), 800),
				detector.update(frame(110, 410, 510), 900),
				detector.update(frame(135, 380, 508), 1_000),
				detector.update(frame(145, 340, 504), 1_100),
				detector.update(frame(170, 300, 500), 1_200),
				detector.update(frame(170, 300, 500), 1_300),
				detector.update(frame(170, 300, 500), 1_400),
			];

			expect(updates.filter(update => update.rep?.variant === 'standard')).toHaveLength(1);
			expect(updates[updates.length - 1].repCounts.standard).toBe(1);
		});

		it('requires three true standing samples after two pulse-up-shaped recovery samples', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const bottom = frame(105, 410, 510);
			detector.update(bottom, 600);
			detector.update(bottom, 700);
			detector.update(bottom, 800);

			// Two samples are not enough to confirm a pulse-up phase. They must not
			// leak into the independent standing evidence counter.
			const pulseUp = frame(145, 380, 508);
			detector.update(pulseUp, 1_000);
			detector.update(pulseUp, 1_100);
			const firstTop = detector.update(frame(170, 300, 500), 1_200);
			const secondTop = detector.update(frame(170, 300, 500), 1_300);
			const thirdTop = detector.update(frame(170, 300, 500), 1_400);

			expect(firstTop.rep).toBeUndefined();
			expect(firstTop.repCounts.standard).toBe(0);
			expect(secondTop.rep).toBeUndefined();
			expect(secondTop.repCounts.standard).toBe(0);
			expect(thirdTop.rep).toEqual({ variant: 'standard', totalReps: 1 });
			expect(thirdTop.repCounts.standard).toBe(1);
		});

		it('allows a confirmed stable bottom hold beyond the cycle timeout to complete', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const bottom = frame(105, 410, 510);
			detector.update(bottom, 600);
			detector.update(bottom, 700);
			detector.update(bottom, 800);

			// Keep callbacks continuous while holding the same confirmed bottom for
			// more than eight seconds. A deliberate isometric hold is not a stalled
			// transition and must remain eligible for one full repetition.
			for (let nowMs = 1_000; nowMs <= 9_000; nowMs += 200) {
				detector.update(bottom, nowMs);
			}
			const standing = completeAtStanding(detector, 9_100);

			expect(standing.rep).toEqual({ variant: 'standard', totalReps: 1 });
			expect(standing.repCounts.standard).toBe(1);
		});

		it('expires a non-bottom, non-top recovery stalled beyond the cycle timeout', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const bottom = frame(105, 410, 510);
			detector.update(bottom, 600);
			detector.update(bottom, 700);
			detector.update(bottom, 800);

			// This stays below standing and just outside bottom without releasing
			// enough compression to become a pulse. Continuous samples exclude a
			// tracking-gap reset; only the movement timeout should cancel it.
			const stalledRecovery = frame(145, 408, 510);
			let expired = detector.update(stalledRecovery, 1_000);
			for (let nowMs = 1_250; nowMs <= 9_000; nowMs += 250) {
				expired = detector.update(stalledRecovery, nowMs);
			}

			expect(expired.rep).toBeUndefined();
			expect(expired.repCounts.standard).toBe(0);
			expect(expired.status).toContain('timed out');
			const standing = completeAtStanding(detector, 9_100);
			expect(standing.rep).toBeUndefined();
			expect(standing.repCounts.standard).toBe(0);
		});

		it('keeps a valid squat armed when the selected lowest foot landmarks switch', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const bottom = frame(105, 410, 510);
			const switchedFootBottoms: SquatMetrics[] = [
				{ ...bottom, leftFootX: 75, rightFootX: 255, leftFootY: 525, rightFootY: 527 },
				{ ...bottom, leftFootX: 120, rightFootX: 210, leftFootY: 532, rightFootY: 530 },
				{ ...bottom, leftFootX: 82, rightFootX: 248, leftFootY: 524, rightFootY: 529 },
			];
			detector.update(switchedFootBottoms[0], 600);
			detector.update(switchedFootBottoms[1], 700);
			detector.update(switchedFootBottoms[2], 800);

			const top = frame(170, 300, 500);
			const switchedFootTops: SquatMetrics[] = [
				{ ...top, leftFootX: 78, rightFootX: 252, leftFootY: 520, rightFootY: 526 },
				{ ...top, leftFootX: 118, rightFootX: 212, leftFootY: 530, rightFootY: 528 },
				{ ...top, leftFootX: 85, rightFootX: 245, leftFootY: 522, rightFootY: 525 },
			];
			detector.update(switchedFootTops[0], 1_000);
			detector.update(switchedFootTops[1], 1_100);
			const standing = detector.update(switchedFootTops[2], 1_200);

			expect(standing.rep).toEqual({ variant: 'standard', totalReps: 1 });
			expect(standing.repCounts.standard).toBe(1);
		});

		it('keeps standard recovery jitter out of the Jump Squat state machine', () => {
			const detector = new SquatDetector('standard');
			calibrateStandardDetector(detector);
			const bottom = frame(105, 410, 510);
			detector.update(bottom, 600);
			detector.update(bottom, 700);
			detector.update(bottom, 800);

			// These two recovery frames lift both feet and the pelvis by 0.05 then
			// 0.10 shoulder widths. They remain inside the standard planted-body
			// tolerance, but also satisfy the Jump Squat takeoff signals. Standard
			// mode must finish its own cycle instead of being routed through JUMP_AIR.
			const updates = [
				detector.update(frame(145, 350, 505), 1_000),
				detector.update(frame(170, 295, 495), 1_100),
				detector.update(frame(170, 290, 490), 1_200),
				detector.update(frame(170, 300, 500), 1_300),
			];

			expect(updates.every(update => update.activeVariant !== 'jump')).toBe(true);
			expect(updates.filter(update => update.rep?.variant === 'standard')).toHaveLength(1);
			expect(updates[updates.length - 1].repCounts).toEqual({ standard: 1, jump: 0, pulse: 0 });
		});
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

	it('cancels an airborne jump before reading a late descending reacquisition frame', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(152, 260, 480), 1_000);
		const airborne = detector.update(frame(152, 230, 470), 1_100);

		// No callback arrives for 1.9 seconds. This first reacquisition sample has
		// a plausible downward velocity and used to count before JUMP_MAX_AIR_MS
		// was checked, despite the event no longer being continuous or trustworthy.
		const lateDescent = detector.update(frame(152, 280, 490), 3_000);

		expect(airborne.jumpDiagnostics?.state).toBe('airborne');
		expect(lateDescent.rep).toBeUndefined();
		expect(lateDescent.repCounts.jump).toBe(0);
		expect(lateDescent.jumpDiagnostics?.state).not.toBe('landing');
	});

	it('expires a continuously tracked airborne event before a descent beyond the hard air timeout', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		detector.update(frame(128, 420, 520), 800);
		detector.update(frame(152, 260, 480), 1_000);
		detector.update(frame(152, 230, 470), 1_100);

		// Keep every inter-sample gap inside the jump allowance through 1.7s of
		// air time. The next descending sample is only 200ms later, but arrives
		// after the 1.8s hard event limit and must not win over that timeout.
		for (let nowMs = 1_200; nowMs <= 2_800; nowMs += 100) {
			detector.update(frame(152, 230, 470), nowMs);
		}
		const tooLateDescent = detector.update(frame(152, 280, 490), 3_000);

		expect(tooLateDescent.rep).toBeUndefined();
		expect(tooLateDescent.repCounts.jump).toBe(0);
		expect(tooLateDescent.jumpDiagnostics?.state).toBe('ready');
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

	it('labels a Jump Squat bottom and its hold as the jump variant', () => {
		const detector = new SquatDetector('jump');
		calibrateJumpDetector(detector);
		const bottom = frame(128, 420, 520);
		const entered = detector.update(bottom, 800);
		let holding = entered;
		for (let nowMs = 900; nowMs <= 1_700; nowMs += 100) {
			holding = detector.update(bottom, nowMs);
		}
		const released = detector.update(frame(170, 300, 500), 2_000);

		expect(entered.activeVariant).toBe('jump');
		expect(holding.activeVariant).toBe('jump');
		expect(holding.activeHold).toMatchObject({ variant: 'jump', position: 'bottom' });
		expect(released.completedHold).toMatchObject({ variant: 'jump', position: 'bottom' });
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

	it('cancels a regular squat on the first landmark dropout', () => {
		const detector = new SquatDetector('standard');
		calibrateStandardDetector(detector);
		const bottom = frame(105, 410, 510);
		detector.update(bottom, 600);
		detector.update(bottom, 700);
		detector.update(bottom, 800);
		const gap = detector.gap(850);
		const update = completeAtStanding(detector, 1_000);

		expect(gap.status).toContain('rep cancelled');
		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
	});

	it('does not count when tracking begins at the bottom and returns at standing', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(110, 410, 520), 0);
		detector.update(frame(110, 410, 520), 200);
		detector.update(frame(170, 300, 500), 600);
		const update = detector.update(frame(170, 300, 500), 800);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts.standard).toBe(0);
	});

	it('does not count a confirmed jump in regular Squats mode', () => {
		const detector = new SquatDetector('standard');
		detector.update(frame(170, 300, 500), 0);
		detector.update(frame(128, 420, 520), 500);
		detector.update(frame(128, 420, 520), 600);
		detector.update(frame(166, 260, 480), 800);
		detector.update(frame(166, 230, 470), 900);
		detector.update(frame(166, 280, 490), 1_000);
		const update = detector.update(frame(152, 330, 500), 1_100);

		expect(update.rep).toBeUndefined();
		expect(update.repCounts).toEqual({ standard: 0, jump: 0, pulse: 0 });
	});

	it('counts a controlled bottom-range return as a pulse', () => {
		const detector = new SquatDetector();
		calibrateStandardDetector(detector);
		const bottom = frame(105, 410, 510);
		detector.update(bottom, 600);
		detector.update(bottom, 700);
		detector.update(bottom, 800);
		const pulseTop = frame(145, 380, 508);
		detector.update(pulseTop, 1_000);
		detector.update(pulseTop, 1_100);
		detector.update(pulseTop, 1_200);
		detector.update(bottom, 1_300);
		detector.update(bottom, 1_400);
		const update = detector.update(bottom, 1_500);

		expect(update.rep).toEqual({ variant: 'pulse', totalReps: 1 });
		expect(update.repCounts).toEqual({ standard: 0, jump: 0, pulse: 1 });
	});

	it('still credits the full squat when standing immediately after a pulse', () => {
		const detector = new SquatDetector();
		calibrateStandardDetector(detector);
		const bottom = frame(105, 410, 510);
		detector.update(bottom, 600);
		detector.update(bottom, 700);
		detector.update(bottom, 800);
		const pulseTop = frame(145, 380, 508);
		detector.update(pulseTop, 1_000);
		detector.update(pulseTop, 1_100);
		detector.update(pulseTop, 1_200);
		detector.update(bottom, 1_300);
		detector.update(bottom, 1_400);
		const pulse = detector.update(bottom, 1_500);

		detector.update(frame(170, 300, 500), 1_600);
		detector.update(frame(170, 300, 500), 1_700);
		const standing = detector.update(frame(170, 300, 500), 1_800);

		expect(pulse.rep).toEqual({ variant: 'pulse', totalReps: 1 });
		expect(standing.rep).toEqual({ variant: 'standard', totalReps: 2 });
		expect(standing.repCounts).toEqual({ standard: 1, jump: 0, pulse: 1 });
		expect(standing.totalReps).toBe(2);
	});

	it('shows and saves a settled bottom hold', () => {
		const detector = new SquatDetector();
		calibrateStandardDetector(detector);
		const bottom = frame(105, 410, 510);
		detector.update(bottom, 600);
		detector.update(bottom, 700);
		detector.update(bottom, 800);
		detector.update(bottom, 1_000);
		detector.update(bottom, 1_200);
		detector.update(bottom, 1_400);
		const live = detector.update(bottom, 1_450);
		const completed = detector.finish(1_800);

		expect(live.activeHold).toMatchObject({ variant: 'standard', position: 'bottom' });
		expect(live.activeHold?.durationMs).toBe(750);
		expect(completed.completedHold).toMatchObject({ variant: 'standard', position: 'bottom', durationMs: 750 });
		expect(completed.holds).toHaveLength(1);
	});
});
