# Decisions & Trade-offs

This section records decisions visible in the current implementation. It is not a formal ADR log; dates and rationale are derived from source and Git history.

## Decision summary

| Decision | Status | Benefit | Cost / trade-off |
|---|---|---|---|
| Perform pose inference on-device | Implemented | Immediate feedback; no application runtime upload/backend dependency | Device-specific performance and native build complexity |
| Use GPU delegate without automatic CPU fallback | Implemented since `8d90a28` | Avoids a false fallback caused by no-pose frames and the much slower CPU path observed in history | A genuine GPU incompatibility becomes an initialization/runtime error |
| Process the latest acceptable frame | Implemented since `b3df8e2` | Bounds latency instead of building an asynchronous queue | Intermediate motion frames can be dropped |
| Pin Full model for release; benchmark Heavy separately | Implemented | Stable workout state and predictable bundle choice | Manual benchmark builds; duplicate large model assets in repository |
| Use one pose plus a continuity lock | Implemented | Reduces background-shape switching and computation | Cannot track groups; heuristic is not identity recognition |
| Separate raw detector data from smoothed render data | Implemented | Responsive jump/step detection and a stable overlay | Two pose representations can differ visibly |
| Use world arm extension with 2-D fallback | Implemented | Better view independence with compatibility for older bridges | World coordinates remain estimates; fallback behavior differs by view |
| Normalize movement by shoulder/body scale | Implemented | Reduces sensitivity to camera distance and body size | Foreshortening and noisy shoulder width still affect ratios |
| Keep high-frequency pose state out of React | Implemented | Reduces render pressure and improves visual cadence | More state lives in refs/shared values and is harder to inspect declaratively |
| Downgrade Android profile only | Implemented | Prevents camera-format oscillation | A transient slow start can leave quality reduced until remount |
| Serialize replay using source timestamps | Implemented | Deterministic time-based decisions and frame order | Analysis may be slower than the clip and creates many thumbnail operations |
| Keep exercise thresholds in source | Implemented | Versioned and testable behavior | Tuning requires code change and rebuild |

## D1 — GPU-only local inference

**Context.** The earlier GPU watchdog treated missing pose callbacks as delegate failure even when no person was present. That silently moved Android to a slower CPU path.

**Decision.** Configure `Delegate.GPU` for both live and image modes and surface detection errors rather than infer failure from an empty interval.

**Trade-off.** The state is simpler and avoids false degradation, but there is no functional fallback for a device/driver that truly cannot run the GPU delegate. A future compatibility strategy should use an explicit initialization/error signal and a validated alternate profile—not absence of a pose.

## D2 — Freshness over frame completeness

**Context.** MediaPipe live inference is asynchronous. Accepting camera frames faster than inference completes can produce delayed skeletons and counts.

**Decision.** Patch the native Android bridge with an atomic in-flight guard. Skip new frames while busy, then accept the next fresh frame.

**Trade-off.** Interactive latency is bounded, but very short events may be undersampled. The jump detector mitigates this with multiple signals, source timestamps, short allowances, and a replay sampling rate chosen to retain the airborne arc.

## D3 — Stable visuals, raw decisions

**Context.** One Euro filtering and temporal holding make a skeleton pleasant to watch but can flatten or delay the fastest part of a jump or step.

**Decision.** Use filtered landmarks for rendering and general angle/form display, but raw landmarks for lower-body measurement and world-space push-up extension.

**Trade-off.** A count can react before the drawn limb visually catches up. That is preferable to a detector whose correctness depends on a cosmetic filter, but the difference should be understood during QA.

## D4 — Adaptive, body-relative signals

**Context.** Fixed pixel travel and fixed elbow thresholds vary with camera placement, athlete scale, and occlusion.

**Decision.** Normalize distances and velocities by shoulder or fallback body scale. Let the push-up counter learn a decaying personal range and require a full hysteresis cycle.

**Trade-off.** These signals improve portability but are not physical measurements. A noisy or collapsed shoulder span still affects lower-body normalization, and the learned push-up range needs enough real motion before it can count reliably.

## D5 — Dual push-up mechanisms

**Context.** The elbow/phase state machine provides interpretable form phases, but the extension envelope provides a more robust visible counter.

**Decision.** Let `RepDetector` own the visible count and `onRep` event while `StateMachine` plus `FormChecker` continue to create phase/form results.

**Trade-off.** This preserves useful form machinery without sacrificing count robustness, but the two systems may disagree on cycle boundaries or totals. The session contract should eventually define one canonical repetition identity and attach form evidence to it.

## D6 — Full model as a compile-time release choice

**Context.** A heavier model may improve landmark quality but increases size and inference cost. Switching a landmarker mid-workout would discard tracking state.

**Decision.** Pin Full in release source and expose a developer-only Heavy benchmark gate requiring minimum samples, processed FPS, and maximum p95 inference time.

**Trade-off.** The rule prevents unmeasured promotion and runtime discontinuity, but benchmark orchestration is manual and repository-level asset handling is not fully unified.

## D7 — Android-specific degradation

**Context.** Device capability and thermal/load conditions are more reliable when measured than inferred from a hard-coded phone list.

**Decision.** Start high, evaluate measured p95/FPS after a warm-up, and only move down. Lower profiles reduce resolution and idle/active inference targets. Use a batched overlay on every Android device.

**Trade-off.** The strategy is robust to unknown devices and avoids oscillation, but it cannot recover quality after a temporary slowdown without remounting. The Android overlay also has less visual detail than iOS even on high-end phones.

## D8 — Developer replay reuses the live pipeline

**Context.** A separate offline counter would drift from live behavior and make bugs hard to reproduce.

**Decision.** Share model options, coordinate mapping, `onResults`, detector instances, and exercise thresholds. Inject source timestamps and normalize no-pose behavior.

**Trade-off.** Fidelity is high at the detector boundary, but replay camera geometry, exposure, and frame sampling still differ from the true live stream. Replay is a debugging aid, not a substitute for physical-device validation.

## D9 — Source-controlled thresholds and flags

**Context.** The detector is still undergoing movement-specific tuning, especially for jump squats and step distance.

**Decision.** Keep thresholds, model choice, debug switches, and jump-squat visibility as compile-time constants with unit tests.

**Trade-off.** Changes are reviewable and reproducible, but two separate `SHOW_JUMP_SQUATS` flags must remain synchronized, and no staged remote rollout or per-device calibration exists.

## Decision principles inferred from the code

The recurring priorities are:

1. Interactive freshness over exhaustive frame processing.
2. Count continuity over resetting on brief uncertainty.
3. Scale-normalized evidence over fixed pixels.
4. Multiple corroborating signals over a single landmark threshold.
5. Derived numeric diagnostics over collection of raw workout media.
6. Compile-time stability over dynamic model or threshold changes.

These are inferred principles, not a formally approved architecture charter.
