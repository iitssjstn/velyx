/**
 * Skipping intros and credits, and when the next episode is offered — the same rules as the
 * website's player (frontend/src/lib/player.ts), so both behave alike.
 */

export type SkipMode = 'never' | 'ask' | 'always';

export interface SegmentSpan {
  start: number;
  end: number;
}

/** Intro and credits of an episode (only confident or manually set ones come from the server). */
export interface EpisodeSegments {
  fileId: number | null;
  intro: SegmentSpan | null;
  credits: SegmentSpan | null;
  postCredits: SegmentSpan | null;
}

export interface SkipAction {
  kind: 'intro' | 'credits';
  /** Where "skip" goes: the end of the intro, or the post-credits scene / end of the credits. */
  to: number;
  /** Credits with nothing after them: skipping may go straight to the next episode. */
  toNext: boolean;
  mode: 'ask' | 'always';
}

const sameFile = (segments: EpisodeSegments, fileId: number | null | undefined) => !(segments.fileId !== null && fileId != null && segments.fileId !== fileId);

/** The skip offered at `time`, if any (never in the last second of a part, and never past a post-credits scene). */
export function skipAt(segments: EpisodeSegments | null | undefined, fileId: number | null | undefined, time: number, modes: { intro: SkipMode; credits: SkipMode }): SkipAction | null {
  if (!segments || !sameFile(segments, fileId)) return null;
  const inside = (s: SegmentSpan | null): s is SegmentSpan => Boolean(s) && time >= s!.start && time < s!.end - 1;
  if (modes.intro !== 'never' && inside(segments.intro)) return { kind: 'intro', to: segments.intro.end, toNext: false, mode: modes.intro };
  if (modes.credits !== 'never' && inside(segments.credits)) {
    const post = segments.postCredits && segments.postCredits.start >= segments.credits.end - 1 ? segments.postCredits : null;
    return { kind: 'credits', to: post ? post.start : segments.credits.end, toNext: !post, mode: modes.credits };
  }
  return null;
}

/**
 * When the next episode is offered: at the start of the credits when nothing follows them,
 * otherwise (a post-credits scene, or unknown credits) in the last seconds of the episode.
 */
export function upNextStart(segments: EpisodeSegments | null | undefined, fileId: number | null | undefined, duration: number, countdown: number): number | null {
  if (!(duration > 0)) return null;
  const fallback = Math.max(0, duration - Math.max(10, countdown + 2));
  if (segments && sameFile(segments, fileId) && segments.credits && !segments.postCredits && segments.credits.end >= duration - 5) return Math.min(fallback, segments.credits.start);
  return fallback;
}
