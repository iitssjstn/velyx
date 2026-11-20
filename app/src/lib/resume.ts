import { resumePoint } from './playback';

/**
 * How a title starts: where it was asked to (a time, or "resume" from Continue watching and the
 * Resume buttons), or, when it was opened without saying and the viewer stopped somewhere, a question:
 * resume or start over (as on the website). A title the TV or a phone already plays never asks.
 */
export function startChoice(opts: {
  startAt: number | null;
  resume: boolean;
  following: boolean;
  progress: { positionSec: number; durationSec: number; completed?: boolean } | null | undefined;
}): { ask: false; at: number } | { ask: true; at: number } {
  const point = resumePoint(opts.progress);
  if (opts.startAt !== null && Number.isFinite(opts.startAt)) return { ask: false, at: Math.max(0, opts.startAt) };
  if (point === null) return { ask: false, at: 0 };
  if (opts.resume || opts.following) return { ask: false, at: point };
  return { ask: true, at: point };
}

/** The address that plays a title from where the viewer stopped, without asking. */
export function resumeHref(kind: 'movie' | 'episode', id: number): string {
  return `/play/${kind}/${id}?resume=1`;
}
