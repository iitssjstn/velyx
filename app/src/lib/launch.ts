/**
 * The opening screen of the app (the logo while it starts): it goes away once the app is ready, but
 * stays at least LAUNCH_MIN_MS after the app started (so the logo is seen, not a flash) and never
 * longer than LAUNCH_MAX_MS.
 */
export const LAUNCH_MIN_MS = 900;
export const LAUNCH_MAX_MS = 4000;

/** When (ms since start) the opening screen fades out: `readyAt` is when the app was ready, or null. */
export function launchHideAt(readyAt: number | null, min = LAUNCH_MIN_MS, max = LAUNCH_MAX_MS): number {
  if (readyAt === null) return max;
  return Math.min(max, Math.max(min, readyAt));
}
