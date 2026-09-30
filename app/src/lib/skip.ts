/**
 * Skipping intros and credits, and when the next episode is offered — the same rules as the
 * website's player (frontend/src/lib/player.ts), so both behave alike.
 */

export type SkipMode = 'never' | 'ask' | 'always';

export interface SegmentSpan {
  start: number;
  end: number;
  /** How sure the detection is (manual corrections: high); older servers send none. */
  confidence?: 'high' | 'medium';
}

/** Recap, intro and credits of an episode (only confident or manually set ones come from the server). */
export interface EpisodeSegments {
  fileId: number | null;
  /** A recap ("previously on") before the intro (servers before 0.11.0 send none). */
  recap?: SegmentSpan | null;
  intro: SegmentSpan | null;
  credits: SegmentSpan | null;
  postCredits: SegmentSpan | null;
}

export interface SkipAction {
  kind: 'recap' | 'intro' | 'credits';
  /** Where "skip" goes: the end of the intro, or the post-credits scene / end of the credits. */
  to: number;
  /** Credits with nothing after them: skipping may go straight to the next episode. */
  toNext: boolean;
  mode: 'ask' | 'always';
}

const sameFile = (segments: EpisodeSegments, fileId: number | null | undefined) => !(segments.fileId !== null && fileId != null && segments.fileId !== fileId);

/** A skip button stays up at least this long, so it never vanishes before it can be pressed. */
const MIN_VISIBLE = 5;

/**
 * When the skip button for a part is shown: a moment after the detected start (the detection may
 * be a second or two early; less sure, a little later), until just before its end.
 */
export function skipWindow(s: SegmentSpan): { from: number; until: number } {
  const margin = s.confidence === 'medium' ? 2 : s.confidence === 'high' ? 1 : 0;
  const until = s.end - 1;
  const from = Math.max(s.start, Math.min(s.start + margin, until - MIN_VISIBLE));
  return { from, until };
}

/**
 * The skip offered at `time`, if any (never in the last second of a part, and never past a
 * post-credits scene). A recap follows the intro's preference when none is given for it.
 */
export function skipAt(segments: EpisodeSegments | null | undefined, fileId: number | null | undefined, time: number, modes: { recap?: SkipMode; intro: SkipMode; credits: SkipMode }): SkipAction | null {
  if (!segments || !sameFile(segments, fileId)) return null;
  const inside = (s: SegmentSpan | null | undefined): s is SegmentSpan => {
    if (!s) return false;
    const w = skipWindow(s);
    return time >= w.from && time < w.until;
  };
  const recapMode = modes.recap ?? modes.intro;
  if (recapMode !== 'never' && inside(segments.recap)) return { kind: 'recap', to: segments.recap.end, toNext: false, mode: recapMode };
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

/** Seconds the back/forward buttons and double taps jump. */
export const SEEK_STEPS = [5, 10, 15, 30] as const;
export type SeekStep = (typeof SEEK_STEPS)[number];
export const readSeekStep = (v: unknown): SeekStep => (SEEK_STEPS as readonly unknown[]).includes(v) ? (v as SeekStep) : 10;

/** Taps within this time of each other add up to one jump ("+30"). */
export const SEEK_COMBINE_MS = 900;

export interface PendingSeek {
  target: number;
  total: number;
  at: number;
}

/** One more tap of back/forward: quick taps add up from where the previous one aimed. */
export function addSeek(pending: PendingSeek | null, now: number, current: number, delta: number, duration: number): PendingSeek {
  const base = pending && now - pending.at < SEEK_COMBINE_MS ? pending : null;
  const max = duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const target = Math.min(max, Math.max(0, (base?.target ?? current) + delta));
  return { target, total: (base?.total ?? 0) + delta, at: now };
}
