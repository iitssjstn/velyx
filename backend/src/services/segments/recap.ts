import { FRAME_SEC, matchFragments, type Fingerprint } from './fingerprint.js';

/**
 * "Previously on…": finding a recap at the start of an episode (pure logic).
 *
 * A recap is not one recurring sound like an intro: it is a series of short clips taken from
 * earlier episodes. So the part of the episode before its intro is compared with the whole audio
 * of the episodes before it, and the clips found there are gathered into one span. Clips are often
 * cut short (a few seconds each), so the opening is searched in small steps. There is no fixed length
 * or position: an episode without clips from earlier episodes has no recap.
 *
 * Music or a narrator laid over a clip changes its sound, so a clip can fail the strict comparison.
 * Around the clips that did match (the recap is there), the opening is searched a second time with
 * a looser limit, but a piece only counts when several windows in a row agree on where it came from:
 * unrelated audio never lines up like that.
 */

export interface RecapSource {
  /** Fingerprint of a whole earlier episode, from 0 s. */
  full: Fingerprint;
  /** Parts of that episode that are not story (its intro, recap and credits): clips from there do not count. */
  exclude: Array<{ start: number; end: number }>;
}

export interface Recap {
  start: number;
  end: number;
  confidence: 'high' | 'medium' | 'low';
}

/** A recap starts within this many seconds of the episode's start (after a logo or a title). */
const START_WITHIN = 120;
/** Clips further apart than this belong to different things. */
const MAX_GAP = 12;
const MIN_LENGTH = 12;
const MAX_LENGTH = 240;
/** A recap found within this many seconds of the start starts at 0 s: "previously on" and a logo belong to it. */
const SNAP_TO_START = 10;
/** The second, looser search: this far around the clips found first, with this limit (mean differing bits). */
const LOOSE_AROUND = 30;
const LOOSE_MAX_BITS = 11.5;
/**
 * …and only pieces of at least this many windows (about 4 s) that agree on their place in the earlier
 * episode: shorter runs at this limit also turn up between unrelated music.
 */
const LOOSE_WINDOWS = 8;

/**
 * The recap in `head` (the opening of an episode, from 0 s), looking only before `until` seconds
 * (the start of its intro, or the end of the opening part when there is none).
 */
export function detectRecap(head: Fingerprint, until: number, sources: RecapSource[]): Recap | null {
  const endFrame = Math.min(head.words.length, Math.round(until / FRAME_SEC));
  if (endFrame * FRAME_SEC < MIN_LENGTH) return null;
  const skips = sources.map((s) => (refFrame: number) => s.exclude.some((x) => refFrame * FRAME_SEC >= x.start - 2 && refFrame * FRAME_SEC <= x.end + 2));
  const search = (from: number, to: number, opts: { maxMeanBits?: number; minWindows: number }): Span[] => {
    const query = { words: head.words.subarray(from, to) };
    const out: Span[] = [];
    sources.forEach((s, i) => {
      for (const f of matchFragments(query, s.full, { skip: skips[i], step: 3, ...opts })) out.push({ start: (from + f.start) * FRAME_SEC, end: (from + f.end) * FRAME_SEC });
    });
    return out;
  };
  const strict = search(0, endFrame, { minWindows: 5 });
  if (!strict.length) return null;
  // Around what matched, clips under music or a voice-over.
  const first = Math.min(...strict.map((x) => x.start));
  const last = Math.max(...strict.map((x) => x.end));
  const from = Math.max(0, Math.round((first - LOOSE_AROUND) / FRAME_SEC));
  const to = Math.min(endFrame, Math.round((last + LOOSE_AROUND) / FRAME_SEC));
  const loose = to > from ? search(from, to, { maxMeanBits: LOOSE_MAX_BITS, minWindows: LOOSE_WINDOWS }) : [];
  // One timeline of clips (from any earlier episode). A loose piece that mostly repeats a strict one
  // adds nothing; the rest fill in what the strict search missed.
  const extra = loose.filter((l) => overlap(l, strict) < (l.end - l.start) / 2);
  const spans = [...strict, ...extra].sort((a, b) => a.start - b.start);
  const groups: Array<{ start: number; end: number; covered: number; clips: number }> = [];
  for (const s of spans) {
    const g = groups[groups.length - 1];
    if (g && s.start <= g.end + MAX_GAP) {
      g.covered += Math.max(0, s.end - Math.max(s.start, g.end));
      g.end = Math.max(g.end, s.end);
      g.clips++;
    } else groups.push({ start: s.start, end: s.end, covered: s.end - s.start, clips: 1 });
  }
  const g = groups.filter((x) => x.start <= START_WITHIN && x.end - x.start >= MIN_LENGTH && x.end - x.start <= MAX_LENGTH).sort((a, b) => b.covered - a.covered)[0];
  if (!g) return null;
  const coverage = g.covered / (g.end - g.start);
  const confidence = g.clips >= 3 && coverage >= 0.6 ? 'high' : g.clips >= 2 && coverage >= 0.45 ? 'medium' : 'low';
  return { start: g.start <= SNAP_TO_START ? 0 : round(g.start), end: round(g.end), confidence };
}

interface Span {
  start: number;
  end: number;
}

/** Seconds of `span` that `others` already cover. */
function overlap(span: Span, others: Span[]): number {
  return others.reduce((n, o) => n + Math.max(0, Math.min(span.end, o.end) - Math.max(span.start, o.start)), 0);
}

function round(sec: number): number {
  return Math.round(sec * 10) / 10;
}
