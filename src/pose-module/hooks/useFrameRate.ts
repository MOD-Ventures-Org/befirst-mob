import { useCallback, useRef } from 'react';

// EMA weight for the FPS estimate — low enough that the HUD reads steady,
// high enough to show real drops within ~a second.
const FPS_SMOOTHING = 0.1;

export function useFrameRate() {
  const lastFrameTime = useRef(Date.now());
  const smoothedFps = useRef(0);

  const measure = useCallback(() => {
    const now = Date.now();
    const dt = now - lastFrameTime.current;
    lastFrameTime.current = now;
    if (dt <= 0) return smoothedFps.current;

    const fps = 1000 / dt;
    smoothedFps.current =
      smoothedFps.current === 0
        ? fps
        : smoothedFps.current + (fps - smoothedFps.current) * FPS_SMOOTHING;
    return Math.round(smoothedFps.current);
  }, []);

  return { measure };
}
