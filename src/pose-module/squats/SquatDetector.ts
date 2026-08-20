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

export interface SquatDetectorOptions {
	// Standard Squat only. Smaller values require a deeper knee bend.
	standardBottomKneeAngle?: number;
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
	leftFootX: number;
	rightFootX: number;
	leftAnkleY: number;
	rightAnkleY: number;
	leftAnkleX: number;
	rightAnkleX: number;
	pelvisY: number;
	pelvisX: number;
	stanceWidth: number;
	shoulderWidth: number;
	leftHipFootSpan: number;
	rightHipFootSpan: number;
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

interface StandardBottomReferenceSample {
	knees: [number, number];
	compressions: [number, number];
}

const EMPTY_COUNTS: SquatRepCounts = { standard: 0, jump: 0, pulse: 0 };

/**
 * Tracks full squats, Jump Squats, bottom-range pulses, and settled bottom
 * holds. Jump Squats use a timestamp-driven event timeline:
 * squat bottom -> sustained takeoff -> airborne -> sustained landing.
 */
export class SquatDetector {
	constructor(
		private mode: SquatMode = 'standard',
		options: SquatDetectorOptions = {},
	) {
		this.standardBottomKneeAngle = this.normalizeStandardBottomAngle(options.standardBottomKneeAngle);
	}

	private state: MovementState = 'INIT';
	private standardBottomKneeAngle: number;
	private counts: SquatRepCounts = { ...EMPTY_COUNTS };
	private lastRepMs: Record<SquatVariant, number | null> = {
		standard: null,
		jump: null,
		pulse: null,
	};
	private bottomStartedAtMs = 0;
	private bottomEvidenceSinceMs: number | null = null;
	private bottomEvidenceLastMs: number | null = null;
	private bottomEvidenceSamples = 0;
	private topEvidenceSinceMs: number | null = null;
	private topEvidenceLastMs: number | null = null;
	private topEvidenceSamples = 0;
	private pulseUpEvidenceSinceMs: number | null = null;
	private pulseUpEvidenceLastMs: number | null = null;
	private pulseUpEvidenceSamples = 0;
	private standardBottomKneeReference: [number, number] | null = null;
	private standardBottomCompressionReference: [number, number] | null = null;
	private standardBottomReferenceSamples: StandardBottomReferenceSample[] = [];
	private standardMovementStartedAtMs: number | null = null;
	private standardLastStableBottomAtMs: number | null = null;
	private calibrationSamples: GroundBaseline[] = [];
	private calibrationSinceMs: number | null = null;
	private calibrationLastMs: number | null = null;
	private ground: GroundBaseline | null = null;
	private takeoffEvidenceSinceMs: number | null = null;
	private jumpTopReachedAtMs: number | null = null;
	private landingEvidenceSinceMs: number | null = null;
	private jumpAirStartedAtMs = 0;
	private maxFootRiseSW = 0;
	private previousJumpSample: JumpSample | null = null;
	private lastJumpSignals: JumpSignals | null = null;
	private lastMetricsAtMs: number | null = null;
	private previousPelvisY: number | null = null;
	private previousAtMs: number | null = null;
	private holdStartedAtMs: number | null = null;
	private holdLastStableAtMs = 0;
	private holdVariant: BaseSquatVariant = 'standard';
	private holds: SquatHold[] = [];
	private nextHoldId = 1;
	private status = 'Get your full body in frame';

	// This is intentionally safe to call only between sets in the UI. If an
	// integrating app changes the setting mid-repetition, discard that partial
	// movement rather than combining two different depth targets into one rep.
	setStandardBottomKneeAngle(angle: number): void {
		if (this.mode !== 'standard') return;
		this.standardBottomKneeAngle = this.normalizeStandardBottomAngle(angle);
		this.state = 'INIT';
		this.ground = null;
		this.resetStandardCandidate();
		this.resetMotionSamples();
		this.completeHold();
		this.status = 'Get your full body in frame';
	}

	update(metrics: SquatMetrics, nowMs: number): SquatUpdate {
		const elapsedSinceLastMetrics =
			this.lastMetricsAtMs === null ? null : nowMs - this.lastMetricsAtMs;
		this.lastMetricsAtMs = nowMs;
		// Android can miss the callback entirely while no person is detected. Keep
		// this guard inside the detector so a stale BOTTOM can never survive until
		// a standing reacquisition frame, even on an old/unpatched native build.
		if (
			this.mode === 'standard' &&
			elapsedSinceLastMetrics !== null &&
			(elapsedSinceLastMetrics <= 0 || elapsedSinceLastMetrics > SQUAT_PARAMS.STANDARD_MAX_SAMPLE_GAP_MS)
		) {
			return this.pause(nowMs, 'Tracking interrupted — rep cancelled; stand still to re-arm');
		}
		// Some Android builds do not deliver a callback while the pose is absent.
		// Never accept a late descending frame as the landing of an old airborne
		// event: the missing interval could contain either landing or subject loss.
		if (
			this.mode === 'jump' &&
			elapsedSinceLastMetrics !== null &&
			elapsedSinceLastMetrics > SQUAT_PARAMS.JUMP_TRACKING_GAP_MS &&
			(this.state === 'JUMP_AIR' || this.takeoffEvidenceSinceMs !== null)
		) {
			return this.pause(nowMs, 'Jump tracking interrupted — event cancelled');
		}
		// A kneeling/plank transition can create the same 2-D knee-angle pattern
		// as a squat (bent knees followed by straight knees). Do not let it arm or
		// finish a normal squat; preserve previously counted repetitions but reset
		// the partial movement immediately.
		if (this.mode === 'standard' && metrics.isUpright === false) {
			return this.pause(nowMs, 'Stand upright for squats');
		}
		const pelvisSpeed = this.pelvisSpeed(metrics, nowMs);
		const maxTorsoLean =
			this.mode === 'jump' ? SQUAT_PARAMS.JUMP_MAX_TORSO_LEAN_DEG : SQUAT_PARAMS.MAX_TORSO_LEAN_DEG;
		if (metrics.torsoLean > maxTorsoLean) {
			return this.pause(nowMs, 'Face the camera and keep your torso upright');
		}
		if (this.mode === 'standard' && this.ground && !this.standardBodyAnchored(metrics)) {
			return this.pause(nowMs, 'Keep both feet planted — rep cancelled');
		}

		const bottomKneeAngle =
			this.mode === 'jump' ? SQUAT_PARAMS.JUMP_BOTTOM_KNEE_ANGLE : this.standardBottomKneeAngle;
		const isBottom =
			this.mode === 'standard'
				? this.hasBilateralBottomShape(metrics, bottomKneeAngle) && this.isGroundedStandardBottom(metrics)
				: metrics.kneeAngle <= bottomKneeAngle;
		const remainsLow =
			this.mode === 'standard'
				? this.hasBilateralBottomShape(metrics, this.standardBottomKneeAngle) && this.isGroundedStandardBottom(metrics)
				: metrics.kneeAngle <= SQUAT_PARAMS.BOTTOM_EXIT_KNEE_ANGLE;
		const kneesAtTop =
			this.mode === 'standard'
				? this.bothKneesAtOrAbove(metrics, SQUAT_PARAMS.TOP_KNEE_ANGLE)
				: metrics.kneeAngle >= SQUAT_PARAMS.TOP_KNEE_ANGLE;
		const atTop =
			this.mode === 'standard' && this.ground
				? kneesAtTop && this.standardLegsRecovered(metrics)
				: kneesAtTop;
		if (this.mode === 'standard' && this.state === 'BOTTOM' && remainsLow) {
			this.standardLastStableBottomAtMs = nowMs;
		}
		const standardTimeoutReferenceMs =
			this.state === 'TOP'
				? this.standardMovementStartedAtMs
				: this.standardLastStableBottomAtMs ?? this.standardMovementStartedAtMs;
		if (
			this.mode === 'standard' &&
			this.standardMovementStartedAtMs !== null &&
			standardTimeoutReferenceMs !== null &&
			!(this.state === 'BOTTOM' && remainsLow) &&
			nowMs - standardTimeoutReferenceMs > SQUAT_PARAMS.STANDARD_MAX_CYCLE_MS
		) {
			return this.pause(nowMs, 'Squat movement timed out — stand still to re-arm');
		}
		if (!atTop) this.jumpTopReachedAtMs = null;
		// Airborne signals belong exclusively to Jump Squats. Running them for a
		// standard squat lets ordinary ankle/pelvis recovery jitter move the shared
		// state into JUMP_AIR and silently steal an otherwise valid repetition.
		if (this.mode === 'jump') {
			const jumpSignals = this.measureJumpSignals(metrics, nowMs);
			if (this.state === 'BOTTOM' || this.state === 'PULSE_UP') {
				this.updateTakeoffEvidence(jumpSignals, metrics.kneeAngle, nowMs);
			} else if (this.state === 'JUMP_AIR') {
				this.updateLandingEvidence(jumpSignals, nowMs);
			}
		}
		if (this.mode === 'standard' && this.state === 'BOTTOM' && isBottom) {
			this.updateStandardBottomReference(metrics);
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
				} else if (kneesAtTop) {
					this.updateStandardCalibration(metrics, nowMs);
				} else {
					this.resetCalibration();
				}
				break;
			case 'TOP':
				if (
					this.mode === 'standard' &&
					this.standardMovementStartedAtMs === null &&
					this.hasBilateralDescent(metrics)
				) {
					this.standardMovementStartedAtMs = nowMs;
				}
				if (isBottom) {
					if (this.mode === 'jump') {
						this.enterBottom(nowMs);
					} else {
						if (this.confirmBottomEvidence(nowMs)) {
							this.enterBottom(nowMs, metrics);
						}
					}
				} else {
					this.resetBottomEvidence();
					if (this.mode === 'standard' && atTop) this.standardMovementStartedAtMs = null;
				}
				break;
			case 'BOTTOM':
				if (atTop && this.takeoffEvidenceSinceMs === null) {
					this.resetPulseUpEvidence();
					if (this.holdTopForJumpTakeoff(nowMs)) break;
					if (this.mode === 'standard') {
						if (!this.confirmTopEvidence(nowMs)) break;
						if (
							this.standardMovementStartedAtMs === null ||
							nowMs - this.standardMovementStartedAtMs < SQUAT_PARAMS.STANDARD_MIN_CYCLE_MS
						) {
							return this.pause(nowMs, 'Movement was too brief — stand still and try again');
						}
						rep = this.count('standard', nowMs);
					}
					this.resetStandardPhaseEvidence();
					this.resetStandardBottomReference();
					this.standardMovementStartedAtMs = null;
					if (this.mode === 'jump') this.setGroundBaseline(metrics, nowMs);
					this.state = 'TOP';
				} else if (
					this.mode === 'standard' &&
					this.hasBilateralPulseUpShape(metrics) &&
					nowMs - this.bottomStartedAtMs >= SQUAT_PARAMS.MIN_BOTTOM_TO_PULSE_MS
				) {
					if (this.confirmPulseUpEvidence(nowMs)) {
						this.resetStandardPhaseEvidence();
						this.state = 'PULSE_UP';
					}
				} else {
					this.resetTopEvidence();
					this.resetPulseUpEvidence();
				}
				break;
			case 'PULSE_UP':
				if (atTop && this.takeoffEvidenceSinceMs === null) {
					if (this.holdTopForJumpTakeoff(nowMs)) break;
					if (this.mode === 'standard') {
						if (!this.confirmTopEvidence(nowMs)) break;
						if (
							this.standardMovementStartedAtMs === null ||
							nowMs - this.standardMovementStartedAtMs < SQUAT_PARAMS.STANDARD_MIN_CYCLE_MS
						) {
							return this.pause(nowMs, 'Movement was too brief — stand still and try again');
						}
						rep = this.count('standard', nowMs);
					}
					this.resetStandardPhaseEvidence();
					this.resetStandardBottomReference();
					this.standardMovementStartedAtMs = null;
					if (this.mode === 'jump') this.setGroundBaseline(metrics, nowMs);
					this.state = 'TOP';
				} else if (isBottom) {
					this.resetTopEvidence();
					if (this.mode === 'standard' && this.confirmBottomEvidence(nowMs)) {
						rep = this.count('pulse', nowMs);
						this.enterBottom(nowMs, metrics);
					}
				} else {
					this.resetTopEvidence();
					this.resetBottomEvidence();
				}
				break;
			case 'JUMP_AIR':
				if (
					nowMs - this.jumpAirStartedAtMs >= SQUAT_PARAMS.JUMP_MAX_AIR_MS
				) {
					// Enforce the hard airborne deadline before considering a late
					// descent. Otherwise valid-looking landing evidence on the boundary
					// can revive and count an already expired jump event.
					this.clearJumpEvent();
					this.state = atTop ? 'TOP' : 'INIT';
				} else if (
					this.landingEvidenceSinceMs !== null &&
					nowMs - this.landingEvidenceSinceMs >= SQUAT_PARAMS.JUMP_LANDING_CONFIRM_MS
				) {
					// Count after the confirmed airborne arc begins descending. Unlike a
					// ground-contact test, this remains robust when one ankle is hidden
					// at landing; unlike takeoff alone, it rejects normal squat ascents.
					if (this.mode === 'jump') rep = this.count('jump', nowMs);
					// The first descending frame is still airborne. Keep the last
					// grounded reference so an immediate landing dip can arm the next
					// jump without requiring the athlete to pause at standing.
					this.clearJumpEvent();
					this.state = 'TOP';
				}
				break;
		}

		const completedHold = this.updateHold(
			remainsLow && pelvisSpeed <= SQUAT_PARAMS.HOLD_MAX_PELVIS_SPEED_SW_S,
			this.mode,
			nowMs,
		);
		this.status = this.movementStatus();
		return this.buildUpdate(nowMs, rep, completedHold);
	}

	// Standard Squats are cancelled on the first missing measurement. Holding a
	// bottom state through a dropout lets leaving the image and returning upright
	// complete a fake rep. Jump mode retains its narrow airborne-gap allowance.
	// After the narrow jump-specific allowance, only the active jump event is
	// cleared; the session count survives until the broader session-level
	// tracking timeout calls pause().
	gap(nowMs: number): SquatUpdate {
		if (this.mode === 'standard') {
			return this.pause(nowMs, 'Tracking lost — rep cancelled; return fully in frame');
		}
		const trackingAgeMs = this.lastMetricsAtMs === null ? 0 : Math.max(0, nowMs - this.lastMetricsAtMs);
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
		this.ground = null;
		this.resetStandardCandidate();
		this.resetMotionSamples();
		this.clearJumpEvent();
		this.status = reason;
		const completedHold = this.updateHold(false, this.mode, nowMs);
		return this.buildUpdate(nowMs, undefined, completedHold);
	}

	finish(nowMs: number): SquatUpdate {
		this.state = 'INIT';
		this.ground = null;
		this.resetStandardCandidate();
		this.resetMotionSamples();
		this.clearJumpEvent();
		this.status = 'Session finished';
		return this.buildUpdate(nowMs, undefined, this.completeHold());
	}

	reset(): void {
		this.state = 'INIT';
		this.counts = { ...EMPTY_COUNTS };
		this.lastRepMs = { standard: null, jump: null, pulse: null };
		this.bottomStartedAtMs = 0;
		this.resetStandardCandidate();
		this.ground = null;
		this.clearJumpEvent();
		this.resetMotionSamples();
		this.lastMetricsAtMs = null;
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

	private normalizeStandardBottomAngle(angle: number = SQUAT_PARAMS.BOTTOM_KNEE_ANGLE): number {
		const { STANDARD_BOTTOM_KNEE_ANGLE_MIN: min, STANDARD_BOTTOM_KNEE_ANGLE_MAX: max, STANDARD_BOTTOM_KNEE_ANGLE_STEP: step } =
			SQUAT_PARAMS;
		const bounded = Math.max(min, Math.min(max, angle));
		return min + Math.round((bounded - min) / step) * step;
	}

	private enterBottom(nowMs: number, metrics?: SquatMetrics): void {
		this.state = 'BOTTOM';
		this.bottomStartedAtMs = nowMs;
		this.resetStandardPhaseEvidence();
		if (this.mode === 'standard' && metrics) {
			const knees = this.kneeAngles(metrics);
			if (knees && this.ground) {
				this.standardBottomReferenceSamples = [
					{ knees: [knees[0], knees[1]], compressions: this.standardLegCompressions(metrics) },
				];
				this.refreshStandardBottomReference();
			} else {
				this.resetStandardBottomReference();
			}
			this.standardLastStableBottomAtMs = nowMs;
		} else {
			this.resetStandardBottomReference();
			this.standardLastStableBottomAtMs = null;
		}
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
			leftFootX: metrics.leftFootX ?? metrics.leftAnkleX,
			rightFootX: metrics.rightFootX ?? metrics.rightAnkleX,
			leftAnkleY: metrics.leftAnkleY,
			rightAnkleY: metrics.rightAnkleY,
			leftAnkleX: metrics.leftAnkleX,
			rightAnkleX: metrics.rightAnkleX,
			pelvisY: metrics.pelvisY,
			pelvisX: metrics.pelvisX ?? Number.NaN,
			stanceWidth: metrics.stanceWidth,
			shoulderWidth: metrics.shoulderWidth,
			leftHipFootSpan:
				metrics.leftHipY === undefined ? Number.NaN : metrics.leftAnkleY - metrics.leftHipY,
			rightHipFootSpan:
				metrics.rightHipY === undefined ? Number.NaN : metrics.rightAnkleY - metrics.rightHipY,
		};
	}

	private kneeAngles(metrics: SquatMetrics): [number, number] | null {
		const { leftKneeAngle: left, rightKneeAngle: right } = metrics;
		if (left === undefined || right === undefined || !Number.isFinite(left) || !Number.isFinite(right)) {
			return null;
		}
		return [left, right];
	}

	private bothKneesAtOrBelow(metrics: SquatMetrics, angle: number): boolean {
		const knees = this.kneeAngles(metrics);
		if (!knees) return false;
		const [left, right] = knees;
		return left <= angle && right <= angle;
	}

	private bothKneesAtOrAbove(metrics: SquatMetrics, angle: number): boolean {
		const knees = this.kneeAngles(metrics);
		if (!knees) return false;
		const [left, right] = knees;
		return left >= angle && right >= angle;
	}

	private hasBilateralBottomShape(metrics: SquatMetrics, angle: number): boolean {
		const knees = this.kneeAngles(metrics);
		if (!knees) return false;
		const [left, right] = knees;
		return (
			left <= angle &&
			right <= angle &&
			Math.abs(left - right) <= SQUAT_PARAMS.STANDARD_MAX_KNEE_DIFFERENCE_DEG
		);
	}

	private hasBilateralPulseUpShape(metrics: SquatMetrics): boolean {
		const knees = this.kneeAngles(metrics);
		if (
			!knees ||
			!this.standardBottomKneeReference ||
			!this.standardBottomCompressionReference ||
			!this.isGroundedStandardBottom(metrics)
		) {
			return false;
		}
		const kneeExcursions: [number, number] = [
			knees[0] - this.standardBottomKneeReference[0],
			knees[1] - this.standardBottomKneeReference[1],
		];
		const availableKneeRange =
			SQUAT_PARAMS.TOP_KNEE_ANGLE -
			Math.max(this.standardBottomKneeReference[0], this.standardBottomKneeReference[1]);
		const minimumKneeExcursion = Math.min(
			SQUAT_PARAMS.STANDARD_MIN_PULSE_KNEE_EXCURSION_DEG,
			Math.max(3, availableKneeRange / 2),
		);
		const currentCompressions = this.standardLegCompressions(metrics);
		const compressionReleases: [number, number] = [
			this.standardBottomCompressionReference[0] - currentCompressions[0],
			this.standardBottomCompressionReference[1] - currentCompressions[1],
		];
		const availableCompressionRange =
			Math.min(
				this.standardBottomCompressionReference[0],
				this.standardBottomCompressionReference[1],
			) - SQUAT_PARAMS.STANDARD_MIN_HIP_FOOT_COMPRESSION_SW;
		const minimumCompressionRelease = Math.min(
			SQUAT_PARAMS.STANDARD_MIN_PULSE_COMPRESSION_RELEASE_SW,
			Math.max(0.02, availableCompressionRange / 2),
		);
		return (
			knees[0] < SQUAT_PARAMS.TOP_KNEE_ANGLE &&
			knees[1] < SQUAT_PARAMS.TOP_KNEE_ANGLE &&
			kneeExcursions[0] >= minimumKneeExcursion &&
			kneeExcursions[1] >= minimumKneeExcursion &&
			Math.abs(kneeExcursions[0] - kneeExcursions[1]) <=
				SQUAT_PARAMS.STANDARD_MAX_PULSE_EXCURSION_ASYMMETRY_DEG &&
			compressionReleases[0] >= minimumCompressionRelease &&
			compressionReleases[1] >= minimumCompressionRelease &&
			Math.abs(compressionReleases[0] - compressionReleases[1]) <=
				SQUAT_PARAMS.STANDARD_MAX_HIP_FOOT_ASYMMETRY_SW
		);
	}

	private updateStandardBottomReference(metrics: SquatMetrics): void {
		const knees = this.kneeAngles(metrics);
		if (!knees || !this.ground) return;
		const compressions = this.standardLegCompressions(metrics);
		this.standardBottomReferenceSamples.push({
			knees: [knees[0], knees[1]],
			compressions: [compressions[0], compressions[1]],
		});
		// A rolling median follows a deliberately deeper bottom while preventing
		// lifetime tracking noise from making the relative pulse threshold easier.
		this.standardBottomReferenceSamples = this.standardBottomReferenceSamples.slice(-5);
		this.refreshStandardBottomReference();
	}

	private refreshStandardBottomReference(): void {
		if (this.standardBottomReferenceSamples.length === 0) {
			this.standardBottomKneeReference = null;
			this.standardBottomCompressionReference = null;
			return;
		}
		const median = (values: number[]) => {
			const sorted = [...values].sort((a, b) => a - b);
			const middle = Math.floor(sorted.length / 2);
			return sorted.length % 2 === 0
				? (sorted[middle - 1] + sorted[middle]) / 2
				: sorted[middle];
		};
		this.standardBottomKneeReference = [
			median(this.standardBottomReferenceSamples.map(sample => sample.knees[0])),
			median(this.standardBottomReferenceSamples.map(sample => sample.knees[1])),
		];
		this.standardBottomCompressionReference = [
			median(this.standardBottomReferenceSamples.map(sample => sample.compressions[0])),
			median(this.standardBottomReferenceSamples.map(sample => sample.compressions[1])),
		];
	}

	private resetStandardBottomReference(): void {
		this.standardBottomKneeReference = null;
		this.standardBottomCompressionReference = null;
		this.standardBottomReferenceSamples = [];
		this.standardLastStableBottomAtMs = null;
	}

	private standardBodyAnchored(metrics: SquatMetrics): boolean {
		if (!this.ground || !this.isReliableStandardSample(metrics)) return false;
		const current = this.baselineSample(metrics);
		const scale = this.ground.shoulderWidth;
		const within = (value: number, baseline: number, limit: number) =>
			Math.abs(value - baseline) / scale <= limit;
		return (
			Math.abs(current.shoulderWidth / scale - 1) <= SQUAT_PARAMS.STANDARD_MAX_SCALE_CHANGE_RATIO &&
			// Heel/toe selection can legitimately change as the foot rotates. Fixed
			// ankle identities provide the standard-squat ground anchor; the dynamic
			// lowest-foot points remain reserved for airborne Jump Squat signals.
			within(current.leftAnkleY, this.ground.leftAnkleY, SQUAT_PARAMS.STANDARD_MAX_FOOT_TRAVEL_SW) &&
			within(current.rightAnkleY, this.ground.rightAnkleY, SQUAT_PARAMS.STANDARD_MAX_FOOT_TRAVEL_SW) &&
			within(current.leftAnkleX, this.ground.leftAnkleX, SQUAT_PARAMS.STANDARD_MAX_FOOT_TRAVEL_SW) &&
			within(current.rightAnkleX, this.ground.rightAnkleX, SQUAT_PARAMS.STANDARD_MAX_FOOT_TRAVEL_SW) &&
			within(
				current.pelvisX,
				this.ground.pelvisX,
				SQUAT_PARAMS.STANDARD_MAX_BODY_CENTER_SHIFT_SW,
			) &&
			Math.abs(current.stanceWidth - this.ground.stanceWidth) <= SQUAT_PARAMS.STANDARD_MAX_STANCE_CHANGE_SW
		);
	}

	private isGroundedStandardBottom(metrics: SquatMetrics): boolean {
		if (!this.ground || !this.standardBodyAnchored(metrics)) return false;
		const [leftCompression, rightCompression] = this.standardLegCompressions(metrics);
		return (
			leftCompression >= SQUAT_PARAMS.STANDARD_MIN_HIP_FOOT_COMPRESSION_SW &&
			rightCompression >= SQUAT_PARAMS.STANDARD_MIN_HIP_FOOT_COMPRESSION_SW &&
			Math.abs(leftCompression - rightCompression) <= SQUAT_PARAMS.STANDARD_MAX_HIP_FOOT_ASYMMETRY_SW
		);
	}

	private standardLegCompressions(metrics: SquatMetrics): [number, number] {
		if (!this.ground) return [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
		const current = this.baselineSample(metrics);
		return [
			(this.ground.leftHipFootSpan - current.leftHipFootSpan) / this.ground.shoulderWidth,
			(this.ground.rightHipFootSpan - current.rightHipFootSpan) / this.ground.shoulderWidth,
		];
	}

	private standardLegsRecovered(metrics: SquatMetrics): boolean {
		if (!this.ground || !this.standardBodyAnchored(metrics)) return false;
		const [leftCompression, rightCompression] = this.standardLegCompressions(metrics);
		return (
			Math.abs(leftCompression) <= SQUAT_PARAMS.STANDARD_TOP_RECOVERY_TOLERANCE_SW &&
			Math.abs(rightCompression) <= SQUAT_PARAMS.STANDARD_TOP_RECOVERY_TOLERANCE_SW
		);
	}

	private hasBilateralDescent(metrics: SquatMetrics): boolean {
		const knees = this.kneeAngles(metrics);
		if (!knees || !this.ground || !this.standardBodyAnchored(metrics)) return false;
		const [leftCompression, rightCompression] = this.standardLegCompressions(metrics);
		const minimumEarlyCompression = SQUAT_PARAMS.STANDARD_MIN_HIP_FOOT_COMPRESSION_SW / 3;
		return (
			knees[0] < SQUAT_PARAMS.TOP_KNEE_ANGLE &&
			knees[1] < SQUAT_PARAMS.TOP_KNEE_ANGLE &&
			leftCompression >= minimumEarlyCompression &&
			rightCompression >= minimumEarlyCompression
		);
	}

	private updateStandardCalibration(metrics: SquatMetrics, nowMs: number): void {
		if (!this.isReliableStandardSample(metrics)) {
			this.resetCalibration();
			return;
		}

		const sample = this.baselineSample(metrics);
		const first = this.calibrationSamples[0];
		const sampleGap = this.calibrationLastMs === null ? 0 : nowMs - this.calibrationLastMs;
		const shouldRestart =
			!first ||
			sampleGap <= 0 ||
			sampleGap > SQUAT_PARAMS.STANDARD_MAX_SAMPLE_GAP_MS ||
			!this.isStableTopSample(sample, first);

		if (shouldRestart) {
			this.calibrationSamples = [sample];
			this.calibrationSinceMs = nowMs;
			this.calibrationLastMs = nowMs;
			return;
		}

		this.calibrationSamples.push(sample);
		this.calibrationLastMs = nowMs;
		if (
			this.calibrationSinceMs === null ||
			this.calibrationSamples.length < SQUAT_PARAMS.STANDARD_CALIBRATION_MIN_SAMPLES ||
			nowMs - this.calibrationSinceMs < SQUAT_PARAMS.STANDARD_CALIBRATION_MS
		) {
			return;
		}

		this.ground = this.medianBaseline(this.calibrationSamples);
		this.previousJumpSample = { ...this.ground, atMs: nowMs };
		this.lastJumpSignals = null;
		this.state = 'TOP';
		this.resetStandardPhaseEvidence();
		this.standardMovementStartedAtMs = null;
		this.resetCalibration();
	}

	private isReliableStandardSample(metrics: SquatMetrics): boolean {
		const sample = this.baselineSample(metrics);
		return (
			metrics.leftFootConfidence !== undefined &&
			metrics.rightFootConfidence !== undefined &&
			metrics.leftFootConfidence >= SQUAT_PARAMS.STANDARD_JOINT_CONFIDENCE_MIN &&
			metrics.rightFootConfidence >= SQUAT_PARAMS.STANDARD_JOINT_CONFIDENCE_MIN &&
			sample.shoulderWidth > 0 &&
			Object.values(sample).every(Number.isFinite)
		);
	}

	private isStableTopSample(current: GroundBaseline, reference: GroundBaseline): boolean {
		const scale = reference.shoulderWidth;
		const within = (value: number, baseline: number, limit: number) =>
			Math.abs(value - baseline) / scale <= limit;
		const plantedLimit = SQUAT_PARAMS.STANDARD_MAX_FOOT_TRAVEL_SW;
		return (
			Math.abs(current.shoulderWidth / scale - 1) <= SQUAT_PARAMS.STANDARD_MAX_SCALE_CHANGE_RATIO &&
			within(current.leftAnkleX, reference.leftAnkleX, plantedLimit) &&
			within(current.rightAnkleX, reference.rightAnkleX, plantedLimit) &&
			within(current.leftAnkleY, reference.leftAnkleY, plantedLimit) &&
			within(current.rightAnkleY, reference.rightAnkleY, plantedLimit) &&
			within(current.pelvisX, reference.pelvisX, plantedLimit) &&
			within(
				current.leftHipFootSpan,
				reference.leftHipFootSpan,
				SQUAT_PARAMS.STANDARD_TOP_RECOVERY_TOLERANCE_SW,
			) &&
			within(
				current.rightHipFootSpan,
				reference.rightHipFootSpan,
				SQUAT_PARAMS.STANDARD_TOP_RECOVERY_TOLERANCE_SW,
			) &&
			Math.abs(current.leftAnkleY - current.rightAnkleY) / scale <=
				SQUAT_PARAMS.STANDARD_MAX_FOOT_TRAVEL_SW * 2 &&
			Math.abs(current.leftHipFootSpan - current.rightHipFootSpan) / scale <=
				SQUAT_PARAMS.STANDARD_MAX_HIP_FOOT_ASYMMETRY_SW
		);
	}

	private medianBaseline(samples: GroundBaseline[]): GroundBaseline {
		const median = (key: keyof GroundBaseline) => {
			const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
			const middle = Math.floor(values.length / 2);
			return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
		};
		return {
			leftFootY: median('leftFootY'),
			rightFootY: median('rightFootY'),
			leftFootX: median('leftFootX'),
			rightFootX: median('rightFootX'),
			leftAnkleY: median('leftAnkleY'),
			rightAnkleY: median('rightAnkleY'),
			leftAnkleX: median('leftAnkleX'),
			rightAnkleX: median('rightAnkleX'),
			pelvisY: median('pelvisY'),
			pelvisX: median('pelvisX'),
			stanceWidth: median('stanceWidth'),
			shoulderWidth: median('shoulderWidth'),
			leftHipFootSpan: median('leftHipFootSpan'),
			rightHipFootSpan: median('rightHipFootSpan'),
		};
	}

	private confirmBottomEvidence(nowMs: number): boolean {
		if (
			this.bottomEvidenceSinceMs === null ||
			this.bottomEvidenceLastMs === null ||
			nowMs <= this.bottomEvidenceLastMs ||
			nowMs - this.bottomEvidenceLastMs > SQUAT_PARAMS.STANDARD_PHASE_MAX_GAP_MS
		) {
			this.bottomEvidenceSinceMs = nowMs;
			this.bottomEvidenceLastMs = nowMs;
			this.bottomEvidenceSamples = 1;
			return false;
		}
		this.bottomEvidenceLastMs = nowMs;
		this.bottomEvidenceSamples += 1;
		return (
			this.bottomEvidenceSamples >= SQUAT_PARAMS.STANDARD_PHASE_CONFIRM_MIN_SAMPLES &&
			nowMs - this.bottomEvidenceSinceMs >= SQUAT_PARAMS.STANDARD_PHASE_CONFIRM_MS
		);
	}

	private confirmTopEvidence(nowMs: number): boolean {
		if (
			this.topEvidenceSinceMs === null ||
			this.topEvidenceLastMs === null ||
			nowMs <= this.topEvidenceLastMs ||
			nowMs - this.topEvidenceLastMs > SQUAT_PARAMS.STANDARD_PHASE_MAX_GAP_MS
		) {
			this.topEvidenceSinceMs = nowMs;
			this.topEvidenceLastMs = nowMs;
			this.topEvidenceSamples = 1;
			return false;
		}
		this.topEvidenceLastMs = nowMs;
		this.topEvidenceSamples += 1;
		return (
			this.topEvidenceSamples >= SQUAT_PARAMS.STANDARD_PHASE_CONFIRM_MIN_SAMPLES &&
			nowMs - this.topEvidenceSinceMs >= SQUAT_PARAMS.STANDARD_PHASE_CONFIRM_MS
		);
	}

	private confirmPulseUpEvidence(nowMs: number): boolean {
		if (
			this.pulseUpEvidenceSinceMs === null ||
			this.pulseUpEvidenceLastMs === null ||
			nowMs <= this.pulseUpEvidenceLastMs ||
			nowMs - this.pulseUpEvidenceLastMs > SQUAT_PARAMS.STANDARD_PHASE_MAX_GAP_MS
		) {
			this.pulseUpEvidenceSinceMs = nowMs;
			this.pulseUpEvidenceLastMs = nowMs;
			this.pulseUpEvidenceSamples = 1;
			return false;
		}
		this.pulseUpEvidenceLastMs = nowMs;
		this.pulseUpEvidenceSamples += 1;
		return (
			this.pulseUpEvidenceSamples >= SQUAT_PARAMS.STANDARD_PULSE_CONFIRM_MIN_SAMPLES &&
			nowMs - this.pulseUpEvidenceSinceMs >= SQUAT_PARAMS.STANDARD_PULSE_CONFIRM_MS
		);
	}

	private resetBottomEvidence(): void {
		this.bottomEvidenceSinceMs = null;
		this.bottomEvidenceLastMs = null;
		this.bottomEvidenceSamples = 0;
	}

	private resetTopEvidence(): void {
		this.topEvidenceSinceMs = null;
		this.topEvidenceLastMs = null;
		this.topEvidenceSamples = 0;
	}

	private resetPulseUpEvidence(): void {
		this.pulseUpEvidenceSinceMs = null;
		this.pulseUpEvidenceLastMs = null;
		this.pulseUpEvidenceSamples = 0;
	}

	private resetStandardPhaseEvidence(): void {
		this.resetBottomEvidence();
		this.resetTopEvidence();
		this.resetPulseUpEvidence();
	}

	private resetCalibration(): void {
		this.calibrationSamples = [];
		this.calibrationSinceMs = null;
		this.calibrationLastMs = null;
	}

	private resetStandardCandidate(): void {
		this.resetStandardPhaseEvidence();
		this.resetCalibration();
		this.resetStandardBottomReference();
		this.standardMovementStartedAtMs = null;
		this.standardLastStableBottomAtMs = null;
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
		const minRepMs = variant === 'jump' ? SQUAT_PARAMS.JUMP_MIN_REP_MS : SQUAT_PARAMS.MIN_REP_MS;
		const lastVariantRepMs = this.lastRepMs[variant];
		if (lastVariantRepMs !== null && nowMs - lastVariantRepMs < minRepMs) return undefined;
		this.counts[variant] += 1;
		this.lastRepMs[variant] = nowMs;
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
		if (this.state === 'BOTTOM') return this.mode;
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
			trackingAgeMs: this.lastMetricsAtMs === null ? 0 : Math.max(0, nowMs - this.lastMetricsAtMs),
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
