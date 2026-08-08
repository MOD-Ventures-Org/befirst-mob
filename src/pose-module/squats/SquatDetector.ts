import { SQUAT_PARAMS } from '../exercises/squat.config';
import type { SquatMetrics } from './squatMetrics';

export type SquatVariant = 'standard' | 'jump' | 'pulse';
export type SquatMode = 'standard' | 'jump';
export type SquatHoldPosition = 'bottom';

export interface SquatHold {
	id: number;
	variant: Exclude<SquatVariant, 'pulse'>;
	position: SquatHoldPosition;
	durationMs: number;
}

export interface ActiveSquatHold {
	variant: Exclude<SquatVariant, 'pulse'>;
	position: SquatHoldPosition;
	durationMs: number;
}

export interface SquatRepCounts {
	standard: number;
	jump: number;
	pulse: number;
}

export interface SquatTrackingState {
	repCounts: SquatRepCounts;
	totalReps: number;
	activeVariant: SquatVariant | null;
	activeHold: ActiveSquatHold | null;
	holds: SquatHold[];
	// User-facing reason for the current state. This turns a silent "0 reps"
	// into an actionable next step in the exercise UI.
	status: string;
}

export interface SquatRep {
	variant: SquatVariant;
	totalReps: number;
}

export interface SquatUpdate extends SquatTrackingState {
	rep?: SquatRep;
	completedHold?: SquatHold;
}

type MovementState = 'INIT' | 'TOP' | 'BOTTOM' | 'PULSE_UP' | 'JUMP_AIR';
type BaseSquatVariant = Exclude<SquatVariant, 'pulse'>;

const EMPTY_COUNTS: SquatRepCounts = { standard: 0, jump: 0, pulse: 0 };

/**
 * Tracks full squats, Jump Squats, bottom-range pulses, and settled bottom
 * holds. A jump is recognised only when both feet rise well above their
 * standing level after a completed squat descent.
 */
export class SquatDetector {
	constructor(private mode: SquatMode = 'standard') {}

	private state: MovementState = 'INIT';
	private counts: SquatRepCounts = { ...EMPTY_COUNTS };
	private lastRepMs = 0;
	private bottomStartedAtMs = 0;
	private groundAnkles: { leftY: number; rightY: number } | null = null;
	private maxFootLift = 0;
	private maxAnkleRiseSpeed = 0;
	private jumpAirStartedAtMs = 0;
	private jumpHasLanded = false;
	private jumpConfirmFrames = 0;
	private landingConfirmFrames = 0;
	private previousPelvisY: number | null = null;
	private previousAtMs: number | null = null;
	private previousAnkleY: number | null = null;
	private previousAnkleAtMs: number | null = null;
	private holdStartedAtMs: number | null = null;
	private holdLastStableAtMs = 0;
	private holdVariant: BaseSquatVariant = 'standard';
	private holds: SquatHold[] = [];
	private nextHoldId = 1;
	private status = 'Stand tall to calibrate';

	update(metrics: SquatMetrics, nowMs: number): SquatUpdate {
		const pelvisSpeed = this.pelvisSpeed(metrics, nowMs);
		const ankleVelocity = this.ankleVelocity(metrics, nowMs);
		if (metrics.torsoLean > SQUAT_PARAMS.MAX_TORSO_LEAN_DEG) {
			return this.pause(nowMs, 'Face the camera and keep your torso upright');
		}

		const isBottom = metrics.kneeAngle <= SQUAT_PARAMS.BOTTOM_KNEE_ANGLE;
		const remainsLow = metrics.kneeAngle <= SQUAT_PARAMS.BOTTOM_EXIT_KNEE_ANGLE;
		const atTop = metrics.kneeAngle >= SQUAT_PARAMS.TOP_KNEE_ANGLE;
		const currentFootLift = this.footLift(metrics);
		if (currentFootLift !== null && this.state !== 'TOP') {
			this.maxFootLift = Math.max(this.maxFootLift, currentFootLift);
			if (ankleVelocity < 0) this.maxAnkleRiseSpeed = Math.max(this.maxAnkleRiseSpeed, -ankleVelocity);
		}

		// A single ankle spike is not an airborne jump. Confirm sustained upward
		// lift before changing state, then require a sustained return to the
		// ground before crediting the repetition.
		if (this.state === 'BOTTOM' || this.state === 'PULSE_UP') {
			if (this.isJumpCandidate()) this.jumpConfirmFrames += 1;
			else this.jumpConfirmFrames = 0;
			if (this.jumpConfirmFrames >= SQUAT_PARAMS.JUMP_CONFIRM_FRAMES) {
				this.beginJumpAir(nowMs);
			}
		} else if (this.state === 'JUMP_AIR' && currentFootLift !== null) {
			const hasReturnedToGround =
				currentFootLift <= SQUAT_PARAMS.JUMP_LANDING_MAX_LIFT_SW &&
				this.maxFootLift - currentFootLift >= SQUAT_PARAMS.JUMP_MIN_LANDING_DESCENT_SW;
			this.landingConfirmFrames = hasReturnedToGround ? this.landingConfirmFrames + 1 : 0;
			if (this.landingConfirmFrames >= SQUAT_PARAMS.JUMP_LANDING_CONFIRM_FRAMES) {
				this.jumpHasLanded = true;
			}
		}

		let rep: SquatRep | undefined;
		switch (this.state) {
			case 'INIT':
				if (atTop) {
					this.setGroundAnkles(metrics);
					this.state = 'TOP';
				} else if (isBottom) {
					this.enterBottom(nowMs);
				}
				break;
			case 'TOP':
				if (isBottom) this.enterBottom(nowMs);
				break;
			case 'BOTTOM':
				// A rising ankle can be the start of a jump. Wait for the short
				// confirmation window before treating a top position as a normal
				// squat finish; otherwise jump frames are credited or discarded too
				// early when their knee angle briefly reaches the top threshold.
				if (
					atTop &&
					(this.jumpConfirmFrames === 0 ||
						metrics.kneeAngle >= SQUAT_PARAMS.JUMP_CLEAR_TOP_KNEE_ANGLE)
				) {
					if (this.mode === 'standard') {
						rep = this.count('standard', nowMs);
					}
					this.setGroundAnkles(metrics);
					this.state = 'TOP';
				} else if (
					metrics.kneeAngle >= SQUAT_PARAMS.PULSE_UP_MIN_KNEE_ANGLE &&
					metrics.kneeAngle <= SQUAT_PARAMS.PULSE_UP_MAX_KNEE_ANGLE &&
					nowMs - this.bottomStartedAtMs >= SQUAT_PARAMS.MIN_BOTTOM_TO_PULSE_MS
				) {
					this.state = 'PULSE_UP';
				}
				break;
			case 'PULSE_UP':
				if (
					atTop &&
					(this.jumpConfirmFrames === 0 ||
						metrics.kneeAngle >= SQUAT_PARAMS.JUMP_CLEAR_TOP_KNEE_ANGLE)
				) {
					if (this.mode === 'standard') {
						rep = this.count('standard', nowMs);
					}
					this.setGroundAnkles(metrics);
					this.state = 'TOP';
				} else if (isBottom) {
					if (this.mode === 'standard') rep = this.count('pulse', nowMs);
					this.enterBottom(nowMs);
				}
				break;
			case 'JUMP_AIR': {
				// MediaPipe often loses one ankle for the split second of landing.
				// A confirmed take-off followed by a return to the top is still a
				// valid jump, even when that single landing frame was unavailable.
				const landingResolved =
					this.jumpHasLanded || nowMs - this.jumpAirStartedAtMs >= SQUAT_PARAMS.JUMP_MAX_AIR_MS;
				if (
					atTop &&
					landingResolved
				) {
					if (this.mode === 'jump') rep = this.count('jump', nowMs);
					this.setGroundAnkles(metrics);
					this.state = 'TOP';
				}
				break;
			}
		}

		const completedHold = this.updateHold(
			remainsLow && pelvisSpeed <= SQUAT_PARAMS.HOLD_MAX_PELVIS_SPEED_SW_S,
			'standard',
			nowMs,
		);
		this.status = this.movementStatus();
		return this.buildUpdate(nowMs, rep, completedHold);
	}

	// Short landmark gaps are handled by usePoseSession with gap(); this method
	// is intentionally reserved for a sustained loss or an invalid posture.
	pause(nowMs: number, reason = 'Tracking lost — keep your full body in frame'): SquatUpdate {
		this.state = 'INIT';
		this.previousPelvisY = null;
		this.previousAtMs = null;
		this.previousAnkleY = null;
		this.previousAnkleAtMs = null;
		this.jumpConfirmFrames = 0;
		this.landingConfirmFrames = 0;
		this.status = reason;
		const completedHold = this.updateHold(false, 'standard', nowMs);
		return this.buildUpdate(nowMs, undefined, completedHold);
	}

	gap(nowMs: number): SquatUpdate {
		this.status = 'Tracking briefly lost — holding movement state';
		return this.buildUpdate(nowMs);
	}

	finish(nowMs: number): SquatUpdate {
		this.state = 'INIT';
		this.previousPelvisY = null;
		this.previousAtMs = null;
		this.previousAnkleY = null;
		this.previousAnkleAtMs = null;
		this.status = 'Session finished';
		return this.buildUpdate(nowMs, undefined, this.completeHold());
	}

	reset(): void {
		this.state = 'INIT';
		this.counts = { ...EMPTY_COUNTS };
		this.lastRepMs = 0;
		this.bottomStartedAtMs = 0;
		this.groundAnkles = null;
		this.maxFootLift = 0;
		this.maxAnkleRiseSpeed = 0;
		this.jumpAirStartedAtMs = 0;
		this.jumpHasLanded = false;
		this.jumpConfirmFrames = 0;
		this.landingConfirmFrames = 0;
		this.previousPelvisY = null;
		this.previousAtMs = null;
		this.previousAnkleY = null;
		this.previousAnkleAtMs = null;
		this.holdStartedAtMs = null;
		this.holdLastStableAtMs = 0;
		this.holdVariant = 'standard';
		this.holds = [];
		this.nextHoldId = 1;
		this.status = 'Stand tall to calibrate';
	}

	snapshot(nowMs = Date.now()): SquatTrackingState {
		const activeHold = this.activeHold(nowMs);
		return {
			repCounts: { ...this.counts },
			totalReps: this.totalReps(),
			activeVariant: activeHold?.variant ?? this.activeMovementVariant(),
			activeHold,
			holds: [...this.holds],
			status: this.status,
		};
	}

	private buildUpdate(nowMs: number, rep?: SquatRep, completedHold?: SquatHold): SquatUpdate {
		return {
			...this.snapshot(nowMs),
			...(rep ? { rep } : {}),
			...(completedHold ? { completedHold } : {}),
		};
	}

	private pelvisSpeed(metrics: SquatMetrics, nowMs: number): number {
		if (this.previousPelvisY === null || this.previousAtMs === null) {
			this.previousPelvisY = metrics.pelvisY;
			this.previousAtMs = nowMs;
			return Infinity;
		}

		const elapsedSeconds = (nowMs - this.previousAtMs) / 1000;
		const speed =
			elapsedSeconds > 0
				? Math.abs(metrics.pelvisY - this.previousPelvisY) / metrics.shoulderWidth / elapsedSeconds
				: Infinity;
		this.previousPelvisY = metrics.pelvisY;
		this.previousAtMs = nowMs;
		return speed;
	}

	private ankleVelocity(metrics: SquatMetrics, nowMs: number): number {
		if (this.previousAnkleY === null || this.previousAnkleAtMs === null) {
			this.previousAnkleY = metrics.ankleY;
			this.previousAnkleAtMs = nowMs;
			return 0;
		}

		const elapsedSeconds = (nowMs - this.previousAnkleAtMs) / 1000;
		const velocity =
			elapsedSeconds > 0 ? (metrics.ankleY - this.previousAnkleY) / metrics.shoulderWidth / elapsedSeconds : 0;
		this.previousAnkleY = metrics.ankleY;
		this.previousAnkleAtMs = nowMs;
		return velocity;
	}

	private enterBottom(nowMs: number): void {
		this.state = 'BOTTOM';
		this.bottomStartedAtMs = nowMs;
		this.maxFootLift = 0;
		this.maxAnkleRiseSpeed = 0;
		this.jumpHasLanded = false;
		this.jumpConfirmFrames = 0;
		this.landingConfirmFrames = 0;
	}

	private setGroundAnkles(metrics: SquatMetrics): void {
		this.groundAnkles = { leftY: metrics.leftAnkleY, rightY: metrics.rightAnkleY };
	}

	private footLift(metrics: SquatMetrics): number | null {
		if (!this.groundAnkles) return null;
		return Math.min(
			(this.groundAnkles.leftY - metrics.leftAnkleY) / metrics.shoulderWidth,
			(this.groundAnkles.rightY - metrics.rightAnkleY) / metrics.shoulderWidth,
		);
	}

	private isJumpCandidate(): boolean {
		return (
			this.maxFootLift >= SQUAT_PARAMS.JUMP_MIN_ANKLE_LIFT_SW &&
			this.maxAnkleRiseSpeed >= SQUAT_PARAMS.JUMP_MIN_ANKLE_RISE_SPEED_SW_S
		);
	}

	private beginJumpAir(nowMs: number): void {
		this.state = 'JUMP_AIR';
		this.jumpAirStartedAtMs = nowMs;
		this.landingConfirmFrames = 0;
	}

	private count(variant: SquatVariant, nowMs: number): SquatRep | undefined {
		if (nowMs - this.lastRepMs < SQUAT_PARAMS.MIN_REP_MS) return undefined;
		this.counts[variant] += 1;
		this.lastRepMs = nowMs;
		return { variant, totalReps: this.totalReps() };
	}

	private updateHold(stableAtBottom: boolean, variant: BaseSquatVariant, nowMs: number): SquatHold | undefined {
		if (stableAtBottom) {
			if (this.holdStartedAtMs === null) {
				this.holdStartedAtMs = nowMs;
				this.holdVariant = variant;
			}
			this.holdLastStableAtMs = nowMs;
			return undefined;
		}

		if (this.holdStartedAtMs === null || nowMs - this.holdLastStableAtMs <= SQUAT_PARAMS.HOLD_GRACE_MS) {
			return undefined;
		}

		return this.completeHold();
	}

	private completeHold(): SquatHold | undefined {
		if (this.holdStartedAtMs === null) return undefined;

		const durationMs = this.holdLastStableAtMs - this.holdStartedAtMs;
		const completedHold =
			durationMs >= SQUAT_PARAMS.HOLD_MIN_MS
				? { id: this.nextHoldId++, variant: this.holdVariant, position: 'bottom' as const, durationMs }
				: undefined;
		if (completedHold) this.holds.push(completedHold);
		this.holdStartedAtMs = null;
		this.holdLastStableAtMs = 0;
		return completedHold;
	}

	private activeHold(nowMs: number): ActiveSquatHold | null {
		if (this.holdStartedAtMs === null || nowMs - this.holdLastStableAtMs > SQUAT_PARAMS.HOLD_GRACE_MS) return null;
		return {
			variant: this.holdVariant,
			position: 'bottom',
			durationMs: Math.max(0, this.holdLastStableAtMs - this.holdStartedAtMs),
		};
	}

	private activeMovementVariant(): SquatVariant | null {
		if (this.state === 'JUMP_AIR') return 'jump';
		if (this.state === 'PULSE_UP') return 'pulse';
		if (this.state === 'BOTTOM') return 'standard';
		return null;
	}

	private totalReps(): number {
		return this.counts.standard + this.counts.jump + this.counts.pulse;
	}

	private movementStatus(): string {
		switch (this.state) {
			case 'INIT':
				return 'Stand tall to calibrate';
			case 'TOP':
				return 'Lower into your squat';
			case 'BOTTOM':
				return 'Drive up to standing';
			case 'PULSE_UP':
				return 'Return to the bottom for a pulse';
			case 'JUMP_AIR':
				return 'Jump detected — land and stand tall';
		}
	}
}
