import type { ExerciseConfig, JointAngles, JointVelocities, Skeleton } from '../types';

export type PoseModelTier = 'lite' | 'full' | 'heavy';

// Production is pinned to Full. To make a developer-only Heavy benchmark
// build, change this one compile-time constant to 'heavy' after running
// `pnpm run benchmark:model:heavy`; it must never be switched mid-workout.
export const POSE_MODEL_TIER: PoseModelTier = 'full';

// ---------------------------------------------------------------------------
// PUSHUP_PARAMS — tunable constants for the new pipeline (smoothing, depth
// signal, rep detector, plausibility, coaching). Single source of truth.
// ---------------------------------------------------------------------------
export const PUSHUP_PARAMS = {
  // Rep state machine (elbow angle, degrees)
  TOP_ANGLE: 150, // arms extended / top
  BOTTOM_ANGLE: 100, // arms flexed / bottom
  ANGLE_HYST: 8, // hysteresis band around each threshold
  MIN_ROM: 45, // minimum top↔bottom travel for a valid rep
  MIN_REP_MS: 250, // minimum time for one rep (rejects noise)

  // Confidence thresholds (visibility/presence, 0–1)
  SH_MIN: 0.5, // shoulder trusted for counting/posture
  EW_MIN: 0.5, // elbow/wrist trusted (real arm + angle)
  EW_INFER_MAX: 0.3, // below this → inferred arm
  SHOW_CONF: 0.35, // min confidence to (first) draw / update a joint; the
  // stabilizer then holds it static through confidence dips (no dancing)
  DRAW_BODY_MIN: 0.3, // min shoulder confidence to start drawing the skeleton

  // "Too close" detection (normalized 0–1)
  TOO_CLOSE_SHOULDER_W: 0.55, // shoulder width fraction of frame width
  TOO_CLOSE_BBOX: 0.9, // confident-landmark bbox frame coverage

  // Inferred arm geometry
  OUT_ANGLE_DEG: 12, // outward lean from vertical
  INFERRED_ARM_LEN: 1.4, // length as multiple of shoulder width

  // Anatomical plausibility (ratios vs shoulder width). Generous — only reject
  // clearly impossible/scattered skeletons, never valid-but-noisy ones.
  UPPER_ARM_MIN: 0.08, // head-on bottom position foreshortens the upper arm to near-zero (field: 0.13-0.16)
  UPPER_ARM_MAX: 2.4,
  FOREARM_MIN: 0.08, // same — a folded forearm projects almost to a point
  FOREARM_MAX: 2.4,
  SYM_MIN: 0.25,
  SYM_MAX: 4.0,

  // Issue 7: per-leg plausibility. Impossible legs are demoted to not-present
  // so the issue-4 chain fades them (never drawn, never blinked).
  THIGH_MIN: 0.1, // hip→knee length ÷ shoulder width; head-on plank foreshortens legs hard
  THIGH_MAX: 3.0,
  SHIN_MIN: 0.1, // knee→ankle length ÷ shoulder width
  SHIN_MAX: 3.0,
  TORSO_QUAD_SHRINK: 0.85, // shrink the torso polygon toward its center before
  // the leg-through-torso test, so joints at the torso edge are not rejected

  // --- Render stability (issue 4: never blink → hold → fade, no teleport) ---
  HOLD_BEFORE_FADE_MS: 400, // hold-last-known window before fading starts (~0.5 s per doc)
  FADE_OUT_PER_S: 2.5, // alpha lost per second once fading (~0.4 s to invisible)
  FADE_IN_PER_S: 6.0, // alpha gained per second when a joint (re)appears
  TELEPORT_MAX_FRAC: 0.5, // max per-frame joint travel ÷ shoulder width, beyond body motion
  INFERRED_ALPHA: 0.45, // alpha ceiling for inferred (not tracked) limbs
  ALPHA_HIDE_EPS: 0.02, // below this alpha a joint stops being drawn

  // One Euro filter (per-landmark temporal smoothing)
  ONE_EURO_MIN_CUTOFF: 1.0, // lower = smoother when still
  ONE_EURO_BETA: 0.007, // higher = less lag when moving fast
  ONE_EURO_DCUTOFF: 1.0,

  // --- Debug checklist thresholds (diagnostics only, nothing gates counting) ---
  // Standing / distance / framing rows of the on-screen checklist.
  STAND_CONF_MIN: 0.5, // min confidence for every "All visible" joint
  FRAME_MARGIN: 0.03, // landmarks must sit inside [margin, 1−margin] (normalized)
  STAND_HEIGHT_MIN: 0.5, // body extent as fraction of frame — distance proxy
  STAND_HEIGHT_MAX: 0.85,
  STAND_TORSO_MAX_DEG: 20, // torso within this many degrees of vertical
  // Top-position rows of the checklist.
  ARM_EXTENDED_DEG: 160, // fused elbow angle above this = arms extended
  HANDS_UNDER_SHOULDERS_TOL: 0.75, // wrist↔shoulder horizontal offset ÷ shoulder width

  // "Body is upright / vertically extended" — the view-independent standing
  // signal and the counter's only guard (no readiness gate: counting starts
  // with the first push-up). Field finding: with the phone on the floor
  // FACING the athlete, a plank torso projects near-vertically in the image,
  // so any torso-angle rule misreads the view. Vertical leg span below the
  // shoulders (in shoulder widths) separates standing from plank in both the
  // head-on and the side view.
  UPRIGHT_ANKLE_SPAN_SW: 3.0, // ankle this far below shoulders = standing
  UPRIGHT_KNEE_SPAN_SW: 2.0, // knee fallback when ankles are not tracked
  GO_DISPLAY_MS: 1500, // how long the GO banner shows after session start

  // The five upper-body lines (shoulder bridge + both upper arms + both
  // forearms) must stay tracked while counting. When they are lost, counting
  // continues but the UI asks the athlete to face the camera.
  FIVE_LINES_CONF: 0.35, // min shoulder/elbow/wrist confidence to call a line tracked
  FIVE_LINES_LOST_MS: 1200, // continuous loss before the banner (bottom-of-rep dips are shorter)

  // --- v2 robust rep counting (adaptive vertical-oscillation detector) ---
  DEPTH_MIN: 0.3, // min confidence for shoulders/wrist to compute the depth signal
  REP_BAND: 0.3, // hysteresis band as a fraction of the user's depth range: the
  // body must dip past (min + band·range) and return past (max − band·range) for
  // a rep. 0.3 → counts ~70%-depth swings, rejects ~40% partial dips.
  REP_MIN_RANGE: 0.25, // min absolute depth range to treat the motion as real reps
  PLANK_DEPTH_MIN: 0.3, // hands at least this far (·shoulder width) below shoulders
  REP_MIN_MS: 500, // refractory: min time between counted reps
  HANDS_TRAVEL_MAX_SW_S: 1.2, // wrist speed (shoulder-widths/s) above which the
  // hands are traveling (crawling/walking), not planted — depth oscillation is
  // then locomotion and must not count
  DEPTH_RANGE_DECAY: 0.995, // per-frame decay of the running min/max envelope
  // Games' position signal: the display envelope is measured over a rolling
  // window of recent depth samples so a bad frame (plank entry, half-detected
  // skeleton, repositioning) ages out instead of inflating the range for the
  // whole session.
  DISPLAY_WINDOW_FRAMES: 150, // ~6-15 s of pose frames at 10-25 fps
  DISPLAY_ENVELOPE_TRIM: 2, // samples ignored at each end of the window
  // Remapping the central band to the full 0-1 keeps the sprite reaching both
  // screen edges when transition frames still widen the window.
  POSITION_REMAP_LO: 0.12,
  POSITION_REMAP_HI: 0.88,
  DEPTH_HOLD_FRAMES: 6, // hold last depth value through brief tracking dropouts
  LOST_TIMEOUT_MS: 600, // reset the detector after this long with no body

  // MediaPipe detector confidences (higher = fewer false "other object" poses)
  DETECT_CONF: 0.6,
  PRESENCE_CONF: 0.6,
  TRACKING_CONF: 0.6,

  // Release default. The Heavy model is bundled only for developer benchmark
  // builds and may be promoted after it passes poseModelBenchmark.ts on target
  // devices; users never switch models during a workout.
  POSE_MODEL: POSE_MODEL_TIER,

  // Debug HUD (FPS / inference time / delegate / model). Keep it off while
  // exercising; flip this constant temporarily when profiling a device.
  DEBUG_HUD: false,

  // Issue 3: primary-subject lock. A confident detection is rejected as
  // "not our subject" when it teleports or rescales versus the locked
  // signature (shoulder midpoint + width) faster than a human can move.
  SUBJECT_JUMP_MAX: 1.5, // instant jump allowance, in locked shoulder widths
  SUBJECT_DRIFT_PER_S: 3.0, // movement allowance per second since last accept
  SUBJECT_SCALE_MAX: 1.6, // max shoulder-width ratio vs locked (either way)
  SUBJECT_RELOCK_MS: 1500, // continuous rejection/absence before re-locking

  // Issue 5: subtle yellow glow on uncertain joints/segments — internal
  // QA aid for seeing where detection struggles. Default off: in dev builds
  // it read as random orange joints.
  DEBUG_UNCERTAIN_GLOW: false,
  GLOW_ALPHA: 0.3, // glow strength at the uncertain end (subtle by design)
} as const;

export type PushupParams = typeof PUSHUP_PARAMS;

// ---------------------------------------------------------------------------
// pushupConfig — ExerciseConfig for FormChecker / StateMachine (phase-based
// pipeline). These thresholds are kept independent from PUSHUP_PARAMS so the
// form-checking rules stay explicit and easy to tune separately.
// ---------------------------------------------------------------------------

function avgElbow(angles: JointAngles): number {
  return (angles.leftElbow + angles.rightElbow) / 2;
}

function avgWristVelocity(velocities: JointVelocities): number {
  return (velocities.leftWrist + velocities.rightWrist) / 2;
}

function headDeviation(skeleton: Skeleton): number {
  const spineX = (skeleton.leftShoulder.x + skeleton.rightShoulder.x) / 2;
  const shoulderWidth = Math.abs(skeleton.leftShoulder.x - skeleton.rightShoulder.x);
  if (shoulderWidth === 0) return 0;

  return Math.abs(skeleton.nose.x - spineX) / shoulderWidth;
}

export const pushupConfig: ExerciseConfig = {
  id: 'pushup',
  phases: ['WAITING', 'MOVING_DOWN', 'BOTTOM', 'MOVING_UP', 'TOP'],
  countsRepOnTransitionTo: 'WAITING',
  phaseTimeoutFrames: 90, // ~3s at 30fps

  transitions: {
    WAITING: {
      toPhase: 'MOVING_DOWN',
      condition: angles => avgElbow(angles) < 160,
      stableFrames: 3,
    },
    MOVING_DOWN: {
      toPhase: 'BOTTOM',
      condition: angles => avgElbow(angles) < 120,
      stableFrames: 2,
    },
    BOTTOM: {
      toPhase: 'MOVING_UP',
      condition: (angles, velocities) =>
        (velocities !== null && avgWristVelocity(velocities) < -0.15) ||
        avgElbow(angles) > 95,
      stableFrames: 3,
    },
    MOVING_UP: {
      toPhase: 'TOP',
      condition: angles => avgElbow(angles) > 160,
      stableFrames: 4,
    },
    TOP: {
      toPhase: 'WAITING',
      condition: () => true, // Automatically transition to WAITING after counting a rep
      stableFrames: 1,
    },
  },
  formRules: [
    {
      // Body must stay in a straight plank line during the descent and ascent.
      code: 'BACK_NOT_FLAT',
      activePhases: ['MOVING_DOWN', 'MOVING_UP'],
      joints: [
        'leftHip',
        'rightHip',
        'leftShoulder',
        'rightShoulder',
        'leftAnkle',
        'rightAnkle',
      ],
      isCritical: true,
      check: angles => angles.backAngle >= 130 && angles.backAngle <= 180,
      persistent: true,
    },
    {
      // Elbows must reach at least 117 degrees before the rep counts as deep enough.
      code: 'FULL_DEPTH_MISSING',
      activePhases: ['BOTTOM'],
      joints: ['leftElbow', 'rightElbow'],
      isCritical: true,
      check: angles => avgElbow(angles) < 117,
      persistent: false,
    },
    {
      // Elbows should stay tucked; flaring out past 145 degrees stresses the shoulder.
      code: 'ELBOW_FLARE',
      activePhases: ['MOVING_DOWN'],
      joints: ['leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder'],
      isCritical: false,
      check: angles => angles.elbowFlareLeft < 145 && angles.elbowFlareRight < 145,
      persistent: true,
    },
    {
      // Head should stay neutral, not craning forward or sideways.
      code: 'HEAD_NOT_NEUTRAL',
      activePhases: ['WAITING', 'MOVING_DOWN', 'BOTTOM', 'MOVING_UP', 'TOP'],
      joints: ['nose'],
      isCritical: false,
      check: (_angles, skeleton) => headDeviation(skeleton) < 0.3,
      persistent: true,
    },
    {
      // Arms must fully lock out at the top.
      code: 'FULL_EXTENSION_MISSING',
      activePhases: ['TOP'],
      joints: ['leftElbow', 'rightElbow'],
      isCritical: true,
      check: angles => avgElbow(angles) > 170,
      persistent: false,
    },
  ],
};
