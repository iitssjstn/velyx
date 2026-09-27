/**
 * The time a seek bar points at: the finger went down at `startX` and moved `dx` since, on a bar
 * `width` wide. Measuring from the start keeps a drag smooth: the touch's own x is measured against
 * whichever view is under the finger and jumps between them.
 */
export function seekTarget(startX: number, dx: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return Math.max(0, Math.min(1, (startX + dx) / width)) * duration;
}
