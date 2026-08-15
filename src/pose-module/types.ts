export interface Joint {
  x: number; // Screen-space pixels
  y: number;
}

// MediaPipe's metric, body-relative landmark coordinates. Unlike the screen
// skeleton, these retain depth and are therefore appropriate for movement
// signals whose primary motion is toward/away from the camera (for example a
// push-up filmed from the front).
export interface WorldJoint {
	x: number;
	y: number;
	z: number;
}

export interface Skeleton {
  nose: Joint;
  leftEye: Joint;
  rightEye: Joint;
  leftEar: Joint;
  rightEar: Joint;
  leftShoulder: Joint;
  rightShoulder: Joint;
  leftElbow: Joint;
  rightElbow: Joint;
  leftWrist: Joint;
  rightWrist: Joint;
  leftHip: Joint;
  rightHip: Joint;
  leftKnee: Joint;
  rightKnee: Joint;
  leftAnkle: Joint;
  rightAnkle: Joint;
}

// The rendered Skeleton intentionally stops at the ankle. Extra lower-foot
// landmarks travel beside it on PoseFrame so existing rendering/form code
// cannot accidentally depend on a new optional point.
export interface FootLandmarks {
	leftHeel: Joint;
	rightHeel: Joint;
	leftFootIndex: Joint;
	rightFootIndex: Joint;
}

export type FootLandmarkName = keyof FootLandmarks;

export type FootVisibility = Record<FootLandmarkName, number>;
export type WorldFootLandmarks = Record<FootLandmarkName, WorldJoint>;

export type WorldSkeleton = Record<keyof Skeleton, WorldJoint>;

// Per-joint MediaPipe visibility/presence confidence in [0, 1].
export type JointVisibility = Record<keyof Skeleton, number>;

// One detected frame: view-space joints (px), raw normalized joints ([0,1]),
// and per-joint detection confidence.
export interface PoseFrame {
	skeleton: Skeleton;
	normalized: Skeleton;
	// `undefined` only if a native bridge does not expose world landmarks. The
	// current Android/iOS MediaPipe bridge does expose them; keeping this
	// optional preserves a safe 2-D fallback for older builds.
	world?: WorldSkeleton;
	visibility: JointVisibility;
	feet?: {
		skeleton: FootLandmarks;
		normalized: FootLandmarks;
		world?: WorldFootLandmarks;
		visibility: FootVisibility;
	};
}

// What the overlay is allowed to draw this frame (spec §9.1).
export type DisplayTier = 'TOO_CLOSE' | 'NO_BODY' | 'CORE' | 'FULL';

// Coaching message state (spec §10).
export type CoachState =
  | 'TOO_CLOSE'
	| 'TOO_FAR'
	| 'KNEES_NOT_VISIBLE'
  | 'NO_BODY'
  | 'NOT_IN_PLANK' // pre-start: waiting for the push-up position
	| 'NOT_IN_SQUAT' // pre-start: lower body is not fully visible for squat tracking
	| 'NOT_IN_SIDE_STEPS' // pre-start: lower body is not fully visible for side-step tracking
  | 'GO' // session just started — counting is live
  | 'STAND_FACING_CAMERA' // the five upper-body lines are lost — counting continues
  | 'READY' // pre-start: valid pose, waiting for the Start button
  | 'COUNTING';

// Serializable pose the Skia overlay reads from a shared value. Points are in a
// fixed order (see RENDER_POINTS in skeleton.ts); inferred arms substitute the
// elbow/wrist positions, so the bone topology stays constant.
export interface RenderPoint {
	x: number;
	y: number;
	show: boolean;
	// Draw opacity in [0, 1]. Changes at a capped rate per frame (fade), never
	// jumps between 0 and 1 — this is what makes blinking impossible.
	alpha: number;
	// The drawn position is not a trusted detection this frame: low-confidence,
	// inferred from priors, or held/fading after loss. Drives the debug glow.
	uncertain: boolean;
}

export interface RenderPose {
	tier: DisplayTier;
	pts: RenderPoint[];
}

// Pre-stabilizer point: `present` = confidently in frame this frame (update
// position); `offFrame` = clearly outside the frame (the only reason a joint is
// ever hidden). A joint that is in frame but low-confidence is neither — it holds.
export interface RawPoint {
	x: number;
	y: number;
	present: boolean;
	offFrame: boolean;
	// Synthesized from anatomical priors (inferred arm/leg), not tracked. Drawn
	// faded (INFERRED_ALPHA) so guessed limbs never look as certain as real ones.
	inferred?: boolean;
	// Tracked below the trusted confidence threshold (debug glow).
	uncertain?: boolean;
}

export interface RawPose {
	tier: DisplayTier;
	pts: RawPoint[];
}

// Rolling CV performance profile, recomputed on the debug throttle tick.
// `cvFps` counts processed frames; `targetFps` is a nominal target, not a
// measured camera delivery rate, so `droppedPct` is derived, not observed.
export interface PerfSnapshot {
	inferenceAvgMs: number;
	inferenceP95Ms: number;
	cvFps: number;
	targetFps: number;
	droppedPct: number;
	sampleCount: number;
}

export interface DebugInfo {
  fps: number;
  inferenceMs: number;
  landmarksDetected: boolean;
  conf?: number; // mean per-joint landmark visibility/confidence in [0, 1]
  minConf?: number; // lowest per-joint confidence this frame
  coach?: CoachState; // current coaching state
  tier?: DisplayTier; // what the overlay is allowed to draw
  depth?: number | null; // shoulder→hand vertical gap (rep depth signal)
  position?: number | null; // normalized rep position: 1 = top (arms extended), 0 = bottom
  plankish?: boolean; // hands below shoulders (push-up setup)
  counting?: boolean; // rep gating currently active
  missingFrames?: number; // consecutive frames with no detected body
  angles?: JointAngles;
  velocities?: JointVelocities;
  phase?: Phase;
  repCount?: number;
	counter?: {
		exercise: string;
		state: string;
		reason: string;
		signal?: number | null;
		trackingAgeMs?: number;
	};
	perf?: PerfSnapshot;
	poseModelTier?: string;
	heavyModelBenchmarkPassed?: boolean;
  // Live per-condition checklist for the debug overlay (diagnostics only).
  gateChecks?: {
    standing: Array<{ label: string; value: string; ok: boolean }>;
    arming: Array<{ label: string; value: string; ok: boolean }>;
    signal: Array<{ label: string; value: string; ok: boolean }>;
  };
}

export interface JointAngles {
  leftElbow: number; // shoulder–elbow–wrist
  rightElbow: number;
  leftKnee: number; // hip–knee–ankle
  rightKnee: number;
  leftHip: number; // shoulder–hip–knee
  rightHip: number;
  spine: number; // angle of shoulder-midpoint → hip-midpoint from vertical

  backAngle: number; // hip-shoulder-ankle, averaged L+R - back flat rule
  elbowFlareLeft: number; // elbow-shoulder-hip, let-elbow flare rule
  elbowFlareRight: number; // elbow-shoulder-hip, right-elbow flare rule
}

export interface JointVelocities {
  leftWrist: number; // shoulder-widths/s, negative = moving up (screen Y flipped)
  rightWrist: number;
  leftAnkle: number;
  rightAnkle: number;
  pelvis: number; // midpoint of both hips
  nose: number;
}

export type Phase = 'WAITING' | 'MOVING_DOWN' | 'BOTTOM' | 'MOVING_UP' | 'TOP';

export interface PhaseTransition {
  toPhase: Phase;
  condition: (angles: JointAngles, velocities: JointVelocities | null) => boolean;
  stableFrames: number;
}

export interface ExerciseConfig {
  id: string;
  phases: Phase[];
  transitions: Partial<Record<Phase, PhaseTransition>>;
  countsRepOnTransitionTo: Phase;
  formRules: FormRule[];
  phaseTimeoutFrames: number; // reset to WAITING if stuck in any active phase this long
}

export interface StateMachineResult {
  phase: Phase;
  repCount: number;
  transitioned: boolean;
  completedRep?: RepResult; // Set when a rep just finished (valid or not)
}

// Describes one form rule. check() returns true when the athlete is PASSING the rule.
export interface FormRule {
  code: string;
  activePhases: Phase[];
  joints: (keyof Skeleton)[];
  isCritical: boolean;
  check: (angles: JointAngles, skeleton: Skeleton) => boolean;
  persistent: boolean; // true = violated if ever failed; false = violated if never passed
}

// One violation instance — recorded when a FormRule's check() returns false.
export interface FormViolation {
  code: string;
  joints: (keyof Skeleton)[];
  phase: Phase;
  isCritical: boolean;
}

// Per-joint pass/fail/inactive status — drives SkeletonOverlay joint colors.
export type JointStatus = Record<keyof Skeleton, 'pass' | 'fail' | 'inactive'>;

// Full result for a single completed rep.
export interface RepResult {
  repNumber: number;
  isValid: boolean; // false if a critical rule was violated during the cycle
  formScore: number; // 0-100
  violations: FormViolation[];
}

// Output of a full session — returned via onComplete to the main app.
export interface PoseSession {
  exercise: string;
  duration: number; // seconds
  completedAt: Date;
  reps: RepResult[];
  summary: {
    totalReps: number;
    validReps: number;
    avgFormScore: number;
    commonErrors: FormViolation[];
  };
}
