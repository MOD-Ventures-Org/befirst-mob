import type {
	ExerciseConfig,
	FormViolation,
	JointAngles,
	JointVelocities,
	Phase,
	RepResult,
	StateMachineResult,
} from '../types';

export class StateMachine {
	private phase: Phase;
	private stableCount = 0;
	private repCount = 0;

	private hasCriticalViolation = false;
	private seenViolationCodes = new Set<string>();
	private currentRepViolations: FormViolation[] = [];
	private framesInPhase = 0;
	private passedViolationCodes = new Set<string>();

	constructor(private config: ExerciseConfig) {
		this.phase = config.phases[0];
	}

	update(
		angles: JointAngles,
		velocities: JointVelocities | null,
		violations: FormViolation[] = [],
		passedCodes: Set<string> = new Set(),
	): StateMachineResult {
		// Timeout: if stuck in an active phase too long, abandon the rep and return to WAITING
		const initialPhase = this.config.phases[0];

		if (this.phase !== initialPhase) {
			this.framesInPhase++;
			if (this.framesInPhase >= this.config.phaseTimeoutFrames) {
				this.phase = initialPhase;
				this.stableCount = 0;
				this.framesInPhase = 0;
				this.hasCriticalViolation = false;
				this.seenViolationCodes.clear();
				this.currentRepViolations = [];
				this.passedViolationCodes.clear();
				return { phase: this.phase, repCount: this.repCount, transitioned: true };
			}

			// Accumulation moved inside this block (skips WAITING phase)
			for (const v of violations) {
				if (!this.seenViolationCodes.has(v.code)) {
					this.seenViolationCodes.add(v.code);
					this.currentRepViolations.push(v);
					if (v.isCritical) {
						this.hasCriticalViolation = true;
					}
				}
			}

			for (const code of passedCodes) {
				this.passedViolationCodes.add(code);
			}
		} else {
			this.framesInPhase = 0; // reset counter whenever back in WAITING
		}

		const transition = this.config.transitions[this.phase];

		// No outgoing transition defined for this phase - hold
		if (!transition) {
			return { phase: this.phase, repCount: this.repCount, transitioned: false };
		}

		if (transition.condition(angles, velocities)) {
			this.stableCount++;
		} else {
			this.stableCount = 0; // Condition broke - must restart the hold
		}

		if (this.stableCount >= transition.stableFrames) {
			this.phase = transition.toPhase;
			this.stableCount = 0; // Reset stable count for the next transition
			this.framesInPhase = 0;

			if (this.phase === this.config.countsRepOnTransitionTo) {
				this.repCount++;

				// Filter non-persistent violations that eventually passed
				const finalViolations = this.currentRepViolations.filter(v => {
					const rule = this.config.formRules.find(r => r.code === v.code);
					return rule?.persistent !== false || !this.passedViolationCodes.has(v.code);
				});

				// Build the RepResult for this completed cycle
				const completedRep: RepResult = {
					repNumber: this.repCount,
					isValid: !finalViolations.some(v => v.isCritical),
					formScore: this.computeFormScore(finalViolations),
					violations: finalViolations,
				};

				// Reset cycle tracking for the next rep
				this.hasCriticalViolation = false;
				this.seenViolationCodes.clear();
				this.currentRepViolations = [];
				this.passedViolationCodes.clear();

				return {
					phase: this.phase,
					repCount: this.repCount,
					transitioned: true,
					completedRep,
				};
			}

			// Clear leftover violation state when returning to rest (e.g. TOP → WAITING).
			// Violations accumulated during the TOP phase after the rep was counted must not
			// bleed into the next rep's completedRep.
			if (this.phase === initialPhase) {
				this.hasCriticalViolation = false;
				this.seenViolationCodes.clear();
				this.currentRepViolations = [];
				this.passedViolationCodes.clear();
			}

			return { phase: this.phase, repCount: this.repCount, transitioned: true };
		}

		return { phase: this.phase, repCount: this.repCount, transitioned: false };
	}

	getPhase(): Phase {
		return this.phase;
	}

	private computeFormScore(violations: FormViolation[]): number {
		const penalty = violations.reduce((total, v) => total + (v.isCritical ? 30 : 15), 0);
		return Math.max(0, 100 - penalty);
	}

	// Resets phase state only — rep count is preserved. Use when the person
	// temporarily loses plank position mid-session (LOST_TIMEOUT_MS).
	reset(): void {
		this.phase = this.config.phases[0];
		this.stableCount = 0;
		this.hasCriticalViolation = false;
		this.seenViolationCodes.clear();
		this.currentRepViolations = [];
		this.framesInPhase = 0;
		this.passedViolationCodes.clear();
	}

	// Full reset including rep count — use only when starting a new session.
	resetSession(): void {
		this.repCount = 0;
		this.reset();
	}
}
