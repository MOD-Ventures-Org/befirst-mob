import { BANDED_SIDE_STEP_PARAMS } from '../exercises/bandedSideStep.config';
import type { SquatMetrics } from '../squats/squatMetrics';

export type SideStepDirection = 'left' | 'right';

export interface SideStepHold {
	id: number;
	position: 'low-squat';
	durationMs: number;
}

export interface ActiveSideStepHold {
	position: 'low-squat';
	durationMs: number;
}

export interface SideStepMeasurement {
	id: number;
	direction: SideStepDirection;
	// Lead-foot travel normalized by the athlete's shoulder width. This stays
	// comparable when the athlete moves closer to or farther from the camera.
	distanceSW: number;
	// MediaPipe world landmarks are metric estimates. Keep centimetres nullable
	// so older native bridges still expose the reliable relative measurement.
	estimatedDistanceCm: number | null;
}

export interface BandedSideStepTrackingState {
	leftSteps: number;
	rightSteps: number;
	totalSteps: number;
	activeDirection: SideStepDirection | null;
	activeStep: SideStepMeasurement | null;
	lastStep: SideStepMeasurement | null;
	stepHistory: SideStepMeasurement[];
	averageDistanceSW: number | null;
	longestDistanceSW: number | null;
	activeHold: ActiveSideStepHold | null;
	holds: SideStepHold[];
	status: string;
}

export interface BandedSideStepUpdate extends BandedSideStepTrackingState {
	step?: SideStepMeasurement & { totalSteps: number };
	completedHold?: SideStepHold;
}

interface FootBaseline {
	leftX: number;
	rightX: number;
	shoulderWidthPx: number;
	stanceWidth: number;
	estimatedShoulderWidthM: number | null;
}

interface ActiveLead {
	direction: SideStepDirection;
	// +1/-1 is derived from the current anatomical landmark ordering, so it is
	// correct for both mirrored Android previews and unmirrored iOS previews.
	screenDirection: number;
	leadStartX: number;
	trailingStartX: number;
	measurementId: number;
}

type StepState = 'READY' | 'LEADING';

/**
 * Counts a side step when a leading foot moves outward from a low-squat stance
 * and waits for the trailing foot to close the stance before accepting another
 * step. The band itself is optional equipment; body landmarks provide the
 * movement signal.
 */
export class BandedSideStepDetector {
	private state: StepState = 'READY';
	private baseline: FootBaseline | null = null;
	private activeDirection: SideStepDirection | null = null;
	private activeLead: ActiveLead | null = null;
	private leftSteps = 0;
	private rightSteps = 0;
	private lastStepMs: number | null = null;
	private stepHistory: SideStepMeasurement[] = [];
	private nextStepId = 1;
	private previous: { pelvisY: number; leftX: number; rightX: number; atMs: number } | null = null;
	private holdStartedAtMs: number | null = null;
	private holdLastStableAtMs = 0;
	private holds: SideStepHold[] = [];
	private nextHoldId = 1;
	private lowSquatLostAtMs: number | null = null;
	private status = 'Lower into a side-step squat';

	update(metrics: SquatMetrics, nowMs: number): BandedSideStepUpdate {
		const movement = this.measureMovement(metrics, nowMs);
		const inLowSquat =
			metrics.kneeAngle <= BANDED_SIDE_STEP_PARAMS.LOW_SQUAT_MAX_KNEE_ANGLE &&
			metrics.torsoLean <= BANDED_SIDE_STEP_PARAMS.MAX_TORSO_LEAN_DEG;
		if (!inLowSquat) {
			if (this.lowSquatLostAtMs === null) this.lowSquatLostAtMs = nowMs;
			if (nowMs - this.lowSquatLostAtMs <= BANDED_SIDE_STEP_PARAMS.LOW_SQUAT_GRACE_MS) {
				this.status = 'Stay low — holding step state';
				return this.buildUpdate(nowMs);
			}
			return this.pause(nowMs, 'Lower into a side-step squat');
		}
		this.lowSquatLostAtMs = null;

		if (!this.baseline) {
			this.setBaseline(metrics);
			this.status = 'Baseline set — step outward with one foot';
			return this.buildUpdate(nowMs);
		}

		let step: BandedSideStepUpdate['step'];
		if (this.state === 'READY') {
			// Anatomical left/right may appear on either screen side depending on
			// camera platform and mirroring. Measure outward travel away from the
			// other ankle instead of assuming a fixed x-direction.
			const leftDirection = Math.sign(this.baseline.leftX - this.baseline.rightX) || -1;
			const rightDirection = Math.sign(this.baseline.rightX - this.baseline.leftX) || 1;
			const leftLeadDistance =
				((metrics.leftAnkleX - this.baseline.leftX) * leftDirection) / this.baseline.shoulderWidthPx;
			const rightLeadDistance =
				((metrics.rightAnkleX - this.baseline.rightX) * rightDirection) / this.baseline.shoulderWidthPx;
			if (
				leftLeadDistance >= BANDED_SIDE_STEP_PARAMS.LEAD_DISTANCE_MIN_SW ||
				rightLeadDistance >= BANDED_SIDE_STEP_PARAMS.LEAD_DISTANCE_MIN_SW
			) {
				const direction: SideStepDirection = leftLeadDistance >= rightLeadDistance ? 'left' : 'right';
				const distanceSW = direction === 'left' ? leftLeadDistance : rightLeadDistance;
				step = this.count(direction, distanceSW, nowMs);
				if (step) {
					this.state = 'LEADING';
					this.activeDirection = direction;
					this.activeLead = {
						direction,
						screenDirection: direction === 'left' ? leftDirection : rightDirection,
						leadStartX: direction === 'left' ? this.baseline.leftX : this.baseline.rightX,
						trailingStartX: direction === 'left' ? this.baseline.rightX : this.baseline.leftX,
						measurementId: step.id,
					};
					this.status = `Lead ${direction} detected — bring the other foot in`;
				}
			}
		} else {
			this.updateActiveStepDistance(metrics);
			if (this.trailingFootCaughtUp(metrics) || this.hasClosedStance(metrics)) {
				this.setBaseline(metrics);
				this.state = 'READY';
				this.activeDirection = null;
				this.activeLead = null;
				this.status = 'Step outward with the next foot';
			}
		}

		const completedHold = this.updateHold(
			this.state === 'READY' &&
			movement.pelvisSpeed <= BANDED_SIDE_STEP_PARAMS.HOLD_MAX_PELVIS_SPEED_SW_S &&
			movement.footSpeed <= BANDED_SIDE_STEP_PARAMS.HOLD_MAX_FOOT_SPEED_SW_S,
			nowMs,
		);
		if (this.state === 'READY' && !step && this.status !== 'Step outward with the next foot') {
			this.status = 'Step outward with one foot';
		}
		return this.buildUpdate(nowMs, step, completedHold);
	}

	pause(nowMs: number, reason = 'Tracking lost — keep your full body in frame'): BandedSideStepUpdate {
		this.state = 'READY';
		this.baseline = null;
		this.activeDirection = null;
		this.activeLead = null;
		this.previous = null;
		this.lowSquatLostAtMs = null;
		this.status = reason;
		return this.buildUpdate(nowMs, undefined, this.updateHold(false, nowMs));
	}

	gap(nowMs: number): BandedSideStepUpdate {
		this.status = 'Tracking briefly lost — holding step state';
		return this.buildUpdate(nowMs);
	}

	finish(nowMs: number): BandedSideStepUpdate {
		this.state = 'READY';
		this.baseline = null;
		this.activeDirection = null;
		this.activeLead = null;
		this.previous = null;
		this.status = 'Session finished';
		return this.buildUpdate(nowMs, undefined, this.completeHold());
	}

	reset(): void {
		this.state = 'READY';
		this.baseline = null;
		this.activeDirection = null;
		this.activeLead = null;
		this.leftSteps = 0;
		this.rightSteps = 0;
		this.lastStepMs = null;
		this.stepHistory = [];
		this.nextStepId = 1;
		this.previous = null;
		this.lowSquatLostAtMs = null;
		this.holdStartedAtMs = null;
		this.holdLastStableAtMs = 0;
		this.holds = [];
		this.nextHoldId = 1;
		this.status = 'Lower into a side-step squat';
	}

	snapshot(nowMs = Date.now()): BandedSideStepTrackingState {
		const activeStep = this.activeStep();
		const lastStep = this.stepHistory[this.stepHistory.length - 1] ?? null;
		const distances = this.stepHistory.map(step => step.distanceSW);
		return {
			leftSteps: this.leftSteps,
			rightSteps: this.rightSteps,
			totalSteps: this.leftSteps + this.rightSteps,
			activeDirection: this.activeDirection,
			activeStep: activeStep ? { ...activeStep } : null,
			lastStep: lastStep ? { ...lastStep } : null,
			stepHistory: this.stepHistory.map(step => ({ ...step })),
			averageDistanceSW:
				distances.length > 0 ? distances.reduce((total, distance) => total + distance, 0) / distances.length : null,
			longestDistanceSW: distances.length > 0 ? Math.max(...distances) : null,
			activeHold: this.activeHold(nowMs),
			holds: [...this.holds],
			status: this.status,
		};
	}

	private measureMovement(metrics: SquatMetrics, nowMs: number): { pelvisSpeed: number; footSpeed: number } {
		if (!this.previous) {
			this.previous = {
				pelvisY: metrics.pelvisY,
				leftX: metrics.leftAnkleX,
				rightX: metrics.rightAnkleX,
				atMs: nowMs,
			};
			return { pelvisSpeed: Infinity, footSpeed: Infinity };
		}

		const elapsedSeconds = (nowMs - this.previous.atMs) / 1000;
		const scale = metrics.shoulderWidth;
		const movement =
			elapsedSeconds > 0
				? {
					pelvisSpeed: Math.abs(metrics.pelvisY - this.previous.pelvisY) / scale / elapsedSeconds,
					footSpeed:
						Math.max(
							Math.abs(metrics.leftAnkleX - this.previous.leftX),
							Math.abs(metrics.rightAnkleX - this.previous.rightX),
						) /
						scale /
						elapsedSeconds,
				}
				: { pelvisSpeed: Infinity, footSpeed: Infinity };
		this.previous = {
			pelvisY: metrics.pelvisY,
			leftX: metrics.leftAnkleX,
			rightX: metrics.rightAnkleX,
			atMs: nowMs,
		};
		return movement;
	}

	private setBaseline(metrics: SquatMetrics): void {
		this.baseline = {
			leftX: metrics.leftAnkleX,
			rightX: metrics.rightAnkleX,
			shoulderWidthPx: metrics.shoulderWidth,
			stanceWidth: Math.abs(metrics.rightAnkleX - metrics.leftAnkleX) / metrics.shoulderWidth,
			estimatedShoulderWidthM: metrics.estimatedShoulderWidthM ?? null,
		};
	}

	private updateActiveStepDistance(metrics: SquatMetrics): void {
		const lead = this.activeLead;
		if (!lead || !this.baseline) return;
		const leadX = lead.direction === 'left' ? metrics.leftAnkleX : metrics.rightAnkleX;
		const distanceSW = Math.max(
			0,
			((leadX - lead.leadStartX) * lead.screenDirection) / this.baseline.shoulderWidthPx,
		);
		const index = this.stepHistory.findIndex(step => step.id === lead.measurementId);
		if (index < 0 || distanceSW <= this.stepHistory[index].distanceSW) return;
		this.stepHistory[index] = this.measurement(lead.measurementId, lead.direction, distanceSW);
	}

	private activeStep(): SideStepMeasurement | null {
		if (!this.activeLead) return null;
		const measurementId = this.activeLead.measurementId;
		return this.stepHistory.find(step => step.id === measurementId) ?? null;
	}

	private hasClosedStance(metrics: SquatMetrics): boolean {
		if (!this.baseline) return false;
		const stanceWidth = Math.abs(metrics.rightAnkleX - metrics.leftAnkleX) / metrics.shoulderWidth;
		return stanceWidth <= this.baseline.stanceWidth + BANDED_SIDE_STEP_PARAMS.RESET_STANCE_TOL_SW;
	}

	private trailingFootCaughtUp(metrics: SquatMetrics): boolean {
		const lead = this.activeLead;
		if (!lead) return false;
		const trailingX = lead.direction === 'left' ? metrics.rightAnkleX : metrics.leftAnkleX;
		const trailingTravel = ((trailingX - lead.trailingStartX) * lead.screenDirection) / metrics.shoulderWidth;
		return trailingTravel >= BANDED_SIDE_STEP_PARAMS.TRAIL_DISTANCE_MIN_SW;
	}

	private count(direction: SideStepDirection, distanceSW: number, nowMs: number): BandedSideStepUpdate['step'] {
		if (this.lastStepMs !== null && nowMs - this.lastStepMs < BANDED_SIDE_STEP_PARAMS.MIN_STEP_MS) return undefined;
		if (direction === 'left') this.leftSteps += 1;
		else this.rightSteps += 1;
		this.lastStepMs = nowMs;
		const measurement = this.measurement(this.nextStepId++, direction, distanceSW);
		this.stepHistory.push(measurement);
		return { ...measurement, totalSteps: this.leftSteps + this.rightSteps };
	}

	private measurement(id: number, direction: SideStepDirection, distanceSW: number): SideStepMeasurement {
		return {
			id,
			direction,
			distanceSW,
			estimatedDistanceCm: this.baseline?.estimatedShoulderWidthM
				? distanceSW * this.baseline.estimatedShoulderWidthM * 100
				: null,
		};
	}

	private updateHold(stableInPosition: boolean, nowMs: number): SideStepHold | undefined {
		if (stableInPosition) {
			if (this.holdStartedAtMs === null) this.holdStartedAtMs = nowMs;
			this.holdLastStableAtMs = nowMs;
			return undefined;
		}

		if (this.holdStartedAtMs === null || nowMs - this.holdLastStableAtMs <= BANDED_SIDE_STEP_PARAMS.HOLD_GRACE_MS) {
			return undefined;
		}
		return this.completeHold();
	}

	private completeHold(): SideStepHold | undefined {
		if (this.holdStartedAtMs === null) return undefined;
		const durationMs = this.holdLastStableAtMs - this.holdStartedAtMs;
		const completedHold =
			durationMs >= BANDED_SIDE_STEP_PARAMS.HOLD_MIN_MS
				? { id: this.nextHoldId++, position: 'low-squat' as const, durationMs }
				: undefined;
		if (completedHold) this.holds.push(completedHold);
		this.holdStartedAtMs = null;
		this.holdLastStableAtMs = 0;
		return completedHold;
	}

	private activeHold(nowMs: number): ActiveSideStepHold | null {
		if (this.holdStartedAtMs === null || nowMs - this.holdLastStableAtMs > BANDED_SIDE_STEP_PARAMS.HOLD_GRACE_MS) {
			return null;
		}
		return {
			position: 'low-squat',
			durationMs: Math.max(0, this.holdLastStableAtMs - this.holdStartedAtMs),
		};
	}

	private buildUpdate(
		nowMs: number,
		step?: BandedSideStepUpdate['step'],
		completedHold?: SideStepHold,
	): BandedSideStepUpdate {
		return {
			...this.snapshot(nowMs),
			...(step ? { step } : {}),
			...(completedHold ? { completedHold } : {}),
		};
	}
}
