import { FRAME_SEC, longestCommonSegment, soundRatio, type Fingerprint } from './fingerprint.js';

/**
 * Season-level intro and credits detection from audio fingerprints (pure logic; reading the audio
 * is done by the detector service).
 *
 * An intro is audio that recurs near the start of several episodes of the same season; credits
 * recur near the end. Each episode is compared with a few others of its season (and with stored
 * references of intros/credits confirmed earlier); the positions found are clustered, and only
 * results backed by enough agreement get a usable confidence. When in doubt nothing is reported.
 */

/** Bumped whenever the algorithm changes, so older automatic results are redone. */
export const DETECTION_VERSION = 1;

export type Confidence = 'high' | 'medium' | 'low';

export interface EpisodeAudio {
  id: number;
  /** Episode length in seconds. */
  duration: number;
  /** Fingerprint of the opening part, starting at 0 s. */
  head: Fingerprint;
  /** Fingerprint of the closing part, starting at `tailStart` seconds. */
  tail: Fingerprint;
  tailStart: number;
}

export interface Span {
  start: number;
  end: number;
}

export interface Detection {
  intro: (Span & { confidence: Confidence }) | null;
  credits: (Span & { confidence: Confidence }) | null;
  /** Content after the credits (a post-credits scene): never skipped automatically. */
  postCredits: Span | null;
  /** The frames of the intro/credits in this episode's own fingerprints, for new references. */
  introFrames: [number, number] | null;
  creditsFrames: [number, number] | null;
}

export interface References {
  intro: Fingerprint[];
  credits: Fingerprint[];
}

/** Opening part to analyse: the first 6 minutes (at most 35 % of the episode). */
export function headWindow(duration: number): Span {
  return { start: 0, end: Math.min(360, duration * 0.35) };
}

/** Closing part to analyse: the last 6 minutes (at most 30 % of the episode). */
export function tailWindow(duration: number): Span {
  const len = Math.min(360, duration * 0.3);
  return { start: Math.max(0, duration - len), end: duration };
}

const INTRO_MIN = 10;
const INTRO_MAX = 200;
const CREDITS_MIN = 10;
const CREDITS_MAX = 600;
/** Episodes each episode is compared with (besides references). */
const PEERS = 4;
/** Candidates within this many seconds of each other describe the same part. */
const CLUSTER_SEC = 3;
/** A remainder after the credits shorter than this is not a scene. */
const POST_CREDITS_MIN = 15;

interface Candidate {
  start: number;
  end: number;
  ratio: number;
  /** Matched a stored reference (an intro/credits confirmed before) rather than a peer episode. */
  reference: boolean;
  frames: [number, number];
}

const frames = (sec: number) => Math.round(sec / FRAME_SEC);

/** The group of candidates that agree best: most votes, then the longest. */
function cluster(cands: Candidate[]): Candidate[] {
  let best: Candidate[] = [];
  for (const c of cands) {
    const group = cands.filter((o) => Math.abs(o.start - c.start) <= CLUSTER_SEC && Math.abs(o.end - c.end) <= CLUSTER_SEC);
    const weight = (g: Candidate[]) => g.reduce((n, x) => n + (x.reference ? 2 : 1), 0);
    if (weight(group) > weight(best) || (weight(group) === weight(best) && group.length && best.length && group[0].end - group[0].start > best[0].end - best[0].start)) best = group;
  }
  return best;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * High: two or more episodes (or a confirmed reference) agree. Medium: one clear match of a
 * plausible length. Low: anything weaker — reported to admins, never used for skipping.
 */
function confidence(group: Candidate[]): Confidence {
  const votes = group.reduce((n, x) => n + (x.reference ? 2 : 1), 0);
  const ratio = group.reduce((n, x) => n + x.ratio, 0) / group.length;
  if (votes >= 2 && ratio >= 0.6) return 'high';
  if (votes === 1 && ratio >= 0.75) return 'medium';
  return 'low';
}

function peersOf(episodes: EpisodeAudio[], index: number): EpisodeAudio[] {
  // The nearest episodes of the season (intros change between seasons, rarely within one).
  return episodes
    .map((e, i) => ({ e, dist: Math.abs(i - index) }))
    .filter((x) => x.dist > 0)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, PEERS)
    .map((x) => x.e);
}

export function detectEpisode(ep: EpisodeAudio, peers: EpisodeAudio[], refs: References): Detection {
  // ---- intro: recurring audio in the opening part
  const introCands: Candidate[] = [];
  const introOpts = { minFrames: frames(INTRO_MIN), maxFrames: frames(INTRO_MAX) };
  for (const p of peers) {
    const seg = longestCommonSegment(ep.head, p.head, introOpts);
    if (seg) introCands.push({ start: seg.aStart * FRAME_SEC, end: seg.aEnd * FRAME_SEC, ratio: seg.ratio, reference: false, frames: [seg.aStart, seg.aEnd] });
  }
  for (const r of refs.intro) {
    const seg = longestCommonSegment(ep.head, r, { ...introOpts, minFrames: Math.min(introOpts.minFrames, Math.round(r.words.length * 0.8)) });
    if (seg && seg.aEnd - seg.aStart >= r.words.length * 0.8) introCands.push({ start: seg.aStart * FRAME_SEC, end: seg.aEnd * FRAME_SEC, ratio: seg.ratio, reference: true, frames: [seg.aStart, seg.aEnd] });
  }
  const introGroup = cluster(introCands);
  const intro = introGroup.length
    ? { start: round(median(introGroup.map((c) => c.start))), end: round(median(introGroup.map((c) => c.end))), confidence: confidence(introGroup) }
    : null;

  // ---- credits: recurring audio in the closing part
  const creditCands: Candidate[] = [];
  const creditOpts = { minFrames: frames(CREDITS_MIN), maxFrames: frames(CREDITS_MAX) };
  const toAbs = (f: number) => ep.tailStart + f * FRAME_SEC;
  for (const p of peers) {
    const seg = longestCommonSegment(ep.tail, p.tail, creditOpts);
    if (seg) creditCands.push({ start: toAbs(seg.aStart), end: toAbs(seg.aEnd), ratio: seg.ratio, reference: false, frames: [seg.aStart, seg.aEnd] });
  }
  for (const r of refs.credits) {
    const seg = longestCommonSegment(ep.tail, r, { ...creditOpts, minFrames: Math.min(creditOpts.minFrames, Math.round(r.words.length * 0.8)) });
    if (seg && seg.aEnd - seg.aStart >= r.words.length * 0.8) creditCands.push({ start: toAbs(seg.aStart), end: toAbs(seg.aEnd), ratio: seg.ratio, reference: true, frames: [seg.aStart, seg.aEnd] });
  }
  const creditGroup = cluster(creditCands);
  let credits = creditGroup.length
    ? { start: round(median(creditGroup.map((c) => c.start))), end: round(median(creditGroup.map((c) => c.end))), confidence: confidence(creditGroup) }
    : null;

  // ---- after the credits: a scene (real sound, long enough) or just the end of the file
  let postCredits: Span | null = null;
  if (credits) {
    const remaining = ep.duration - credits.end;
    const from = frames(credits.end - ep.tailStart);
    if (remaining >= POST_CREDITS_MIN && soundRatio(ep.tail, from, ep.tail.words.length) >= 0.5) {
      postCredits = { start: credits.end, end: round(ep.duration) };
    } else {
      // Silence or a few seconds after the recurring music still belong to the credits.
      credits = { ...credits, end: round(ep.duration) };
    }
  }
  const introFrames = introGroup.length ? introGroup.sort((a, b) => b.ratio - a.ratio)[0].frames : null;
  const creditsFrames = creditGroup.length ? creditGroup.sort((a, b) => b.ratio - a.ratio)[0].frames : null;
  return { intro, credits, postCredits, introFrames, creditsFrames };
}

/** Detects every episode of one season (episodes in broadcast order). */
export function detectSeason(episodes: EpisodeAudio[], refs: References, only?: Set<number>): Map<number, Detection> {
  const out = new Map<number, Detection>();
  episodes.forEach((ep, i) => {
    if (only && !only.has(ep.id)) return;
    out.set(ep.id, detectEpisode(ep, peersOf(episodes, i), refs));
  });
  return out;
}

function round(sec: number): number {
  return Math.round(sec * 10) / 10;
}
