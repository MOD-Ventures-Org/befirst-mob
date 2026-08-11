# Glossary

| Term | Meaning in this project |
|---|---|
| Accepted frame | A camera frame admitted by the native bridge when no other MediaPipe inference is in flight |
| Active inference FPS | Target pose-processing cadence while a workout session is running |
| Banded side step | A lateral step performed in a low stance; the detector works from body landmarks whether or not a physical band is visible |
| Body extension | The 2-D fallback push-up signal: shoulder-to-wrist vertical gap normalized by shoulder width |
| Coach state | Debounced UI guidance such as `NO_BODY`, `READY`, `GO`, `COUNTING`, or `STAND_FACING_CAMERA` |
| Counter trace | Opt-in, bounded, in-memory samples of derived detector state/reasons; it excludes frames and raw landmark arrays |
| CV FPS | Processed pose-result callbacks per second, measured in JavaScript; not the camera delivery rate |
| Delegate | MediaPipe execution backend. This project selects the GPU delegate |
| Display tier | Render eligibility derived from shoulder presence and anatomical plausibility; current runtime effectively returns `FULL` or `NO_BODY` |
| EAS | Expo Application Services, referenced here for native build profiles |
| Form rule | Phase-specific push-up condition evaluated by `FormChecker` and accumulated into a `RepResult` |
| Full model | The MediaPipe Pose Landmarker Full model selected by current release source |
| Heavy model | Larger MediaPipe pose model tracked for developer benchmarking, not selected by default |
| Hold | A stable bottom squat or low side-step stance whose duration passes configured grace/minimum rules |
| IMAGE mode | MediaPipe mode used to analyze one decoded replay image at a time |
| Inference time | Native result bundle's processing duration for a pose result |
| Joint visibility | MediaPipe visibility/presence confidence used for gating, drawing, and metric validity |
| Latest-frame processing | Overload policy that skips frames while inference is busy instead of accumulating a queue |
| LIVE_STREAM mode | MediaPipe mode used by the front-camera frame processor |
| One Euro filter | Adaptive low-pass filter applied to the visual skeleton to reduce jitter while preserving responsiveness |
| Plankish | Internal condition meaning a push-up extension signal exists and the upright-body veto is false; not a complete biomechanical plank assessment |
| PoseFrame | Canonical mapped frame containing view, normalized, optional world, confidence, and optional foot data |
| PoseSession | In-memory completion object with exercise, wall-clock duration, rep results, and summary |
| p95 inference | Nearest-rank 95th percentile of the rolling inference-time sample buffer |
| Pulse squat | A bottom-range rise and return that does not reach the full standing threshold |
| Pyramid | Push-up set sequence that rises from 1 to a selected level and falls to 1; total reps equal level squared |
| Reanimated shared value | UI-thread-readable mutable value used for per-frame pose/game signals without React renders |
| RenderPose | Stabilized presentation representation with ordered points, opacity, visibility, and uncertainty |
| RepDetector | Adaptive push-up extension-envelope counter that drives the visible count |
| Refractory period | Minimum elapsed time required between credited repetitions or steps |
| Replay coordinator | `ViewCoordinator` implementation that maps IMAGE-mode landmarks into a `contain` video viewport |
| Shoulder-width unit (SW) | Dimensionless distance or speed normalized by the athlete's projected shoulder/body scale |
| Skia | Graphics library used to draw the skeleton and retained game scenes |
| SquatMetrics | Lower-body measurement object derived from raw landmarks, including knee angle, stance, pelvis/feet, and scale |
| State machine | Stateful transition logic for push-up form phases, squat/jump movement, side-step rearming, or pyramid timing |
| Subject lock | Continuity heuristic that follows one pose by shoulder position and scale and rejects abrupt switches |
| Tracking gap | Short interval without valid lower-body metrics during which movement state may be preserved |
| View coordinates | Preview-aligned pixel positions after rotation, fit, and front-camera mirroring conversion |
| World coordinates | MediaPipe body-relative 3-D landmark estimates used for view-independent extension and optional metric approximation |
| Worklet | Code/data path executed outside ordinary React rendering for frame processing or UI-thread animation |

## Abbreviations

| Abbreviation | Expansion |
|---|---|
| CV | Computer vision |
| EAS | Expo Application Services |
| EMA | Exponential moving average |
| FPS | Frames per second |
| GPU | Graphics processing unit |
| POC | Proof of concept; a term retained in pyramid source comments |
| p95 | 95th percentile |
| QA | Quality assurance |
| SW | Shoulder widths |
| UI | User interface |
