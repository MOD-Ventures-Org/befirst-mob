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

// Opt-in diagnostics are numeric, bounded by CounterTraceRecorder, and never
// contain raw frames or camera imagery. They make real-device jump failures
// explainable without collecting a workout video.
export interface JumpDiagnostics {
	state: 'calibrating' | 'ready' | 'armed' | 'takeoff' | 'airborne' | 'landing';
	leftFootRiseSW: number | null;
	rightFootRiseSW: number | null;
	pelvisRiseSW: number | null;
	footRiseSpeedSWs: number | null;
	pelvisRiseSpeedSWs: number | null;
	leftFootConfidence: number | null;
	rightFootConfidence: number | null;
	trackingAgeMs: number;
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
	jumpDiagnostics?: JumpDiagnostics;
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

interface GroundBaseline {
	leftFootY: number;
	rightFootY: number;
	pelvisY: number;
}

interface JumpSignals {
	leftFootRiseSW: number;
	rightFootRiseSW: number;
	pelvisRiseSW: number;
	footRiseSpeedSWs: number;
	pelvisRiseSpeedSWs: number;
	leftFootConfidence: number;
	rightFootConfidence: number;
}

interface JumpSample {
	leftFootY: number;
	rightFootY: number;
	pelvisY: number;
	atMs: number;
}

const EMPTY_COUNTS: SquatRepCounts = { standard: 0, jump: 0, pulse: 0 };

/**
 * Tracks full squats, Jump Squats, bottom-range pulses, and settled bottom
 * holds. Jump Squats use a timestamp-driven event timeline:
 * squat bottom -> sustained takeoff -> airborne -> sustained landing.
 */
export class SquatDetector {
	constructor(private mode: SquatMode = 'standard') {}

	private state: MovementState = 'INIT';
	private counts: SquatRepCounts = { ...EMPTY_COUNTS };
	private lastRepMs = 0;
	private bottomStartedAtMs = 0;
	private ground: GroundBaseline | null = null;
	private takeoffEvidenceSinceMs: number | null = null;
	private jumpTopReachedAtMs: number | null = null;
	private landingEvidenceSinceMs: number | null = null;
	private jumpAirStartedAtMs = 0;
	private maxFootRiseSW = 0;
	private previousJumpSample: JumpSample | null = null;
	private lastJumpSignals: JumpSignals | null = null;
	private lastMetricsAtMs = 0;
	private previousPelvisY: number | null = null;
	private previousAtMs: number | null = null;
	private holdStartedAtMs: number | null = null;
	private holdLastStableAtMs = 0;
	private holdVariant: BaseSquatVariant = 'standard';
	private holds: SquatHold[] = [];
	private nextHoldId = 1;
	private status = 'Get your full body in frame';

	update(metrics: SquatMetrics, nowMs: number): SquatUpdate {
		this.lastMetricsAtMs = nowMs;
		const pelvisSpeed = this.pelvisSpeed(metrics, nowMs);
		const maxTorsoLean =
			this.mode === 'jump' ? SQUAT_PARAMS.JUMP_MAX_TORSO_LEAN_DEG : SQUAT_PARAMS.MAX_TORSO_LEAN_DEG;
		if (metrics.torsoLean > maxTorsoLean) {
			return this.pause(nowMs, 'Face the camera and keep your torso upright');
		}

		const isBottom = metrics.kneeAngle <= SQUAT_PARAMS.BOTTOM_KNEE_ANGLE;
		const remainsLow = metrics.kneeAngle <= SQUAT_PARAMS.BOTTOM_EXIT_KNEE_ANGLE;
		const atTop = metrics.kneeAngle >= SQUAT_PARAMS.TOP_KNEE_ANGLE;
		if (!atTop) this.jumpTopReachedAtMs = null;
		const jumpSignals = this.measureJumpSignals(metrics, nowMs);
		if (this.state === 'BOTTOM' || this.state === 'PULSE_UP') {
			this.updateTakeoffEvidence(jumpSignals, metrics.kneeAngle, nowMs);
		} else if (this.state === 'JUMP_AIR') {
			this.updateLandingEvidence(jumpSignals, nowMs);
		}

		let rep: SquatRep | undefined;
		switch (this.state) {
			case 'INIT':
				if (this.mode === 'jump') {
					// The first valid frame supplies a provisional ground reference. Feet
					// are still planted at both standing and squat bottom, so a replay can
					// begin mid-rep without permanently missing its first jump.
					this.setGroundBaseline(metrics, nowMs);
					if (isBottom) this.enterBottom(nowMs);
					else this.state = 'TOP';
				} else if (atTop) {
					this.setGroundBaseline(metrics, nowMs);
					this.state = 'TOP';
				} else if (isBottom) {
					this.enterBottom(nowMs);
				}
				break;
			case 'TOP':
				if (isBottom) this.enterBottom(nowMs);
				break;
			case 'BOTTOM':
				if (atTop && this.takeoffEvidenceSinceMs === null) {
					if (this.holdTopForJumpTakeoff(nowMs)) break;
					if (this.mode === 'standard') rep = this.count('standard', nowMs);
					this.setGroundBaseline(metrics, nowMs);
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
				if (atTop && this.takeoffEvidenceSinceMs === null) {
					if (this.holdTopForJumpTakeoff(nowMs)) break;
					if (this.mode === 'standard') rep = this.count('standard', nowMs);
					this.setGroundBaseline(metrics, nowMs);
					this.state = 'TOP';
				} else if (isBottom) {
					if (this.mode === 'standard') rep = this.count('pulse', nowMs);
					this.enterBottom(nowMs);
				}
				break;
			case 'JUMP_AIR':
				if (
					this.landingEvidenceSinceMs !== null &&
					nowMs - this.landingEvidenceSinceMs >= SQUAT_PARAMS.JUMP_LANDING_CONFIRM_MS
				) {
					// Count after the confirmed airborne arc begins descending. Unlike a
					// ground-contact test, this remains robust when one ankle is hidden
					// at landing; unlike takeoff alone, it rejects normal squat ascents.
					if (this.mode === 'jump') rep = this.count('jump', nowMs);
					this.setGroundBaseline(metrics, nowMs);
					this.clearJumpEvent();
					this.state = 'TOP';
				} else if (nowMs - this.jumpAirStartedAtMs >= SQUAT_PARAMS.JUMP_MAX_AIR_MS) {
					// Never invent a landing after a long tracking gap: discard the
					// incomplete event and wait for the next real descent instead.
					this.clearJumpEvent();
					this.state = atTop ? 'TOP' : 'INIT';
				}
				break;
		}

		const completedHold = this.updateHold(
			remainsLow && pelvisSpeed <= SQUAT_PARAMS.HOLD_MAX_PELVIS_SPEED_SW_S,
			'standard',
			nowMs,
		);
		this.status = this.movementStatus();
		return this.buildUpdate(nowMs, rep, completedHold);
	}

	// Short landmark gaps are held rather than treated as a completed jump.
	// After the narrow jump-specific allowance, only the active jump event is
	// cleared; the session count and regular squat state survive until the
	// broader session-level tracking timeout calls pause().
	gap(nowMs: number): SquatUpdate {
		const trackingAgeMs = Math.max(0, nowMs - this.lastMetricsAtMs);
		if (
			(this.state === 'JUMP_AIR' || this.takeoffEvidenceSinceMs !== null) &&
			trackingAgeMs > SQUAT_PARAMS.JUMP_TRACKING_GAP_MS
		) {
			this.clearJumpEvent();
			this.state = this.state === 'JUMP_AIR' ? 'TOP' : this.state;
			this.status = 'Feet lost during jump — reset and try the next rep';
		} else {
			this.status = 'Tracking briefly lost — holding movement state';
		}
		return this.buildUpdate(nowMs);
	}

	// Sustained loss or invalid posture never resets already counted reps.
	pause(nowMs: number, reason = 'Tracking lost — keep your full body in frame'): SquatUpdate {
		this.state = 'INIT';
		this.resetMotionSamples();
		this.clearJumpEvent();
		this.status = reason;
		const completedHold = this.updateHold(false, 'standard', nowMs);
		return this.buildUpdate(nowMs, undefined, completedHold);
	}

	finish(nowMs: number): SquatUpdate {
		this.state = 'INIT';
		this.resetMotionSamples();
		this.clearJumpEvent();
		this.status = 'Session finished';
		return this.buildUpdate(nowMs, undefined, this.completeHold());
	}

	reset(): void {
		this.state = 'INIT';
		this.counts = { ...EMPTY_COUNTS };
		this.lastRepMs = 0;
		this.bottomStartedAtMs = 0;
		this.ground = null;
		this.clearJumpEvent();
		this.resetMotionSamples();
		this.lastMetricsAtMs = 0;
		this.holdStartedAtMs = null;
		this.holdLastStableAtMs = 0;
		this.holdVariant = 'standard';
		this.holds = [];
		this.nextHoldId = 1;
		this.status = 'Get your full body in frame';
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
			...(this.mode === 'jump' ? { jumpDiagnostics: this.jumpDiagnostics(nowMs) } : {}),
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

	private enterBottom(nowMs: number): void {
		this.state = 'BOTTOM';
		this.bottomStartedAtMs = nowMs;
		this.jumpTopReachedAtMs = null;
		this.clearJumpEvent();
	}

	private setGroundBaseline(metrics: SquatMetrics, nowMs: number): void {
		this.ground = this.baselineSample(metrics);
		this.jumpTopReachedAtMs = null;
		this.previousJumpSample = { ...this.ground, atMs: nowMs };
		this.lastJumpSignals = null;
	}

	private holdTopForJumpTakeoff(nowMs: number): boolean {
		if (this.mode !== 'jump') return false;
		if (this.jumpTopReachedAtMs === null) {
			this.jumpTopReachedAtMs = nowMs;
			return true;
		}
		return nowMs - this.jumpTopReachedAtMs < SQUAT_PARAMS.JUMP_TAKEOFF_WINDOW_MS;
	}

	private baselineSample(metrics: SquatMetrics): GroundBaseline {
		return {
			leftFootY: metrics.leftFootY ?? metrics.leftAnkleY,
			rightFootY: metrics.rightFootY ?? metrics.rightAnkleY,
			pelvisY: metrics.pelvisY,
		};
	}

	private measureJumpSignals(metrics: SquatMetrics, nowMs: number): JumpSignals | null {
		if (!this.ground) {
			this.lastJumpSignals = null;
			return null;
		}

		const current = this.baselineSample(metrics);
		let footRiseSpeedSWs = 0;
		let pelvisRiseSpeedSWs = 0;
		if (this.previousJumpSample) {
			const elapsedSeconds = (nowMs - this.previousJumpSample.atMs) / 1000;
			if (elapsedSeconds > 0) {
				const previousFootY = (this.previousJumpSample.leftFootY + this.previousJumpSample.rightFootY) / 2;
				const currentFootY = (current.leftFootY + current.rightFootY) / 2;
				footRiseSpeedSWs = (previousFootY - currentFootY) / metrics.shoulderWidth / elapsedSeconds;
				pelvisRiseSpeedSWs =
					(this.previousJumpSample.pelvisY - current.pelvisY) / metrics.shoulderWidth / elapsedSeconds;
			}
		}
		this.previousJumpSample = { ...current, atMs: nowMs };
		this.lastJumpSignals = {
			leftFootRiseSW: (this.ground.leftFootY - current.leftFootY) / metrics.shoulderWidth,
			rightFootRiseSW: (this.ground.rightFootY - current.rightFootY) / metrics.shoulderWidth,
			pelvisRiseSW: (this.ground.pelvisY - current.pelvisY) / metrics.shoulderWidth,
			footRiseSpeedSWs,
			pelvisRiseSpeedSWs,
			leftFootConfidence: metrics.leftFootConfidence ?? 1,
			rightFootConfidence: metrics.rightFootConfidence ?? 1,
		};
		return this.lastJumpSignals;
	}

	private updateTakeoffEvidence(
		signals: JumpSignals | null,
		kneeAngle: number,
		nowMs: number,
	): void {
		if (!signals || !this.ground) return;
		const leftReliable = signals.leftFootConfidence >= SQUAT_PARAMS.JUMP_FOOT_CONFIDENCE_MIN;
		const rightReliable = signals.rightFootConfidence >= SQUAT_PARAMS.JUMP_FOOT_CONFIDENCE_MIN;
		const bothFeetRisen =
			leftReliable &&
			rightReliable &&
			signals.leftFootRiseSW >= SQUAT_PARAMS.JUMP_MIN_FOOT_RISE_SW &&
			signals.rightFootRiseSW >= SQUAT_PARAMS.JUMP_MIN_FOOT_RISE_SW;
		// Side-view clips commonly hide the rear foot. In that case, accept the
		// visible foot only when it rises farther and the pelvis rises with it.
		const oneVisibleFootRisen =
			(leftReliable &&
				!rightReliable &&
				signals.leftFootRiseSW >= SQUAT_PARAMS.JUMP_MIN_ONE_FOOT_RISE_SW) ||
			(rightReliable &&
				!leftReliable &&
				signals.rightFootRiseSW >= SQUAT_PARAMS.JUMP_MIN_ONE_FOOT_RISE_SW);
		const movingUp =
			signals.footRiseSpeedSWs >= SQUAT_PARAMS.JUMP_MIN_RISE_SPEED_SW_S ||
			signals.pelvisRiseSpeedSWs >= SQUAT_PARAMS.JUMP_MIN_RISE_SPEED_SW_S;
		const isTakeoffEvidence =
			kneeAngle >= SQUAT_PARAMS.JUMP_TAKEOFF_KNEE_ANGLE &&
			(bothFeetRisen || oneVisibleFootRisen) &&
			signals.pelvisRiseSW >= SQUAT_PARAMS.JUMP_MIN_PELVIS_RISE_SW &&
			movingUp;

		if (!isTakeoffEvidence) {
			this.takeoffEvidenceSinceMs = null;
			return;
		}

		this.maxFootRiseSW = Math.max(this.maxFootRiseSW, this.effectiveFootRise(signals));
		if (this.takeoffEvidenceSinceMs === null) this.takeoffEvidenceSinceMs = nowMs;
		if (nowMs - this.takeoffEvidenceSinceMs >= SQUAT_PARAMS.JUMP_TAKEOFF_CONFIRM_MS) {
			this.state = 'JUMP_AIR';
			this.jumpAirStartedAtMs = nowMs;
			this.landingEvidenceSinceMs = null;
		}
	}

	private updateLandingEvidence(signals: JumpSignals | null, nowMs: number): void {
		if (!signals) return;
		const averageFootRiseSW = this.effectiveFootRise(signals);
		this.maxFootRiseSW = Math.max(this.maxFootRiseSW, averageFootRiseSW);
		const descendedFromPeak =
			this.maxFootRiseSW >= SQUAT_PARAMS.JUMP_MIN_PEAK_FOOT_RISE_SW &&
			this.maxFootRiseSW - averageFootRiseSW >= SQUAT_PARAMS.JUMP_MIN_DESCENT_FROM_PEAK_SW;
		const movingDown =
			signals.footRiseSpeedSWs <= -SQUAT_PARAMS.JUMP_MIN_FALL_SPEED_SW_S ||
			signals.pelvisRiseSpeedSWs <= -SQUAT_PARAMS.JUMP_MIN_FALL_SPEED_SW_S;
		const isLandingEvidence = descendedFromPeak && movingDown;

		if (!isLandingEvidence) {
			this.landingEvidenceSinceMs = null;
			return;
		}
		if (this.landingEvidenceSinceMs === null) this.landingEvidenceSinceMs = nowMs;
	}

	private effectiveFootRise(signals: JumpSignals): number {
		const reliableRises: number[] = [];
		if (signals.leftFootConfidence >= SQUAT_PARAMS.JUMP_FOOT_CONFIDENCE_MIN) {
			reliableRises.push(signals.leftFootRiseSW);
		}
		if (signals.rightFootConfidence >= SQUAT_PARAMS.JUMP_FOOT_CONFIDENCE_MIN) {
			reliableRises.push(signals.rightFootRiseSW);
		}
		return reliableRises.length > 0
			? reliableRises.reduce((total, rise) => total + rise, 0) / reliableRises.length
			: (signals.leftFootRiseSW + signals.rightFootRiseSW) / 2;
	}

	private clearJumpEvent(): void {
		this.takeoffEvidenceSinceMs = null;
		this.jumpTopReachedAtMs = null;
		this.landingEvidenceSinceMs = null;
		this.jumpAirStartedAtMs = 0;
		this.maxFootRiseSW = 0;
	}

	private resetMotionSamples(): void {
		this.previousPelvisY = null;
		this.previousAtMs = null;
		this.previousJumpSample = null;
		this.lastJumpSignals = null;
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

	private jumpDiagnostics(nowMs: number): JumpDiagnostics {
		const signals = this.lastJumpSignals;
		const state: JumpDiagnostics['state'] =
			this.state === 'BOTTOM' || this.state === 'PULSE_UP'
					? this.takeoffEvidenceSinceMs === null
						? 'armed'
						: 'takeoff'
					: this.state === 'JUMP_AIR'
						? this.landingEvidenceSinceMs === null
							? 'airborne'
							: 'landing'
						: 'ready';
		return {
			state,
			leftFootRiseSW: signals?.leftFootRiseSW ?? null,
			rightFootRiseSW: signals?.rightFootRiseSW ?? null,
			pelvisRiseSW: signals?.pelvisRiseSW ?? null,
			footRiseSpeedSWs: signals?.footRiseSpeedSWs ?? null,
			pelvisRiseSpeedSWs: signals?.pelvisRiseSpeedSWs ?? null,
			leftFootConfidence: signals?.leftFootConfidence ?? null,
			rightFootConfidence: signals?.rightFootConfidence ?? null,
			trackingAgeMs: this.lastMetricsAtMs === 0 ? 0 : Math.max(0, nowMs - this.lastMetricsAtMs),
		};
	}

	private totalReps(): number {
		return this.counts.standard + this.counts.jump + this.counts.pulse;
	}

	private movementStatus(): string {
		switch (this.state) {
			case 'INIT':
				return 'Get your full body in frame';
			case 'TOP':
				return this.mode === 'jump' ? 'Lower into a jump squat' : 'Lower into your squat';
			case 'BOTTOM':
				return this.mode === 'jump' ? 'Drive up and leave the floor' : 'Drive up to standing';
			case 'PULSE_UP':
				return 'Return to the bottom for a pulse';
			case 'JUMP_AIR':
				return 'Jump detected — land softly';
		}
	}
}
