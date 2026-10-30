/**
 * Recognising end credits in the picture: lines of small text on an even background of any colour
 * ("cards", standing still or scrolling), or over the picture itself ("overlay"). Works on small
 * grayscale frames (320×180) decoded from the last minutes of an episode, so it also finds credits
 * whose music differs every episode. A coarse grid per frame lets the detector compare the picture
 * of two episodes (the intro looks the same in every episode). Pure functions; decoding is done by
 * the detector service.
 */

export const FRAME_W = 320;
export const FRAME_H = 180;

/** `credits`: text on an even background. `overlay`: lines of text over the picture. */
export type FrameKind = 'credits' | 'overlay' | 'black' | 'scene';

export interface FrameStats {
  /** Seconds from the start of the file. */
  t: number;
  /** Mean brightness 0–255. */
  mean: number;
  /** Share of dark pixels (< 50). */
  dark: number;
  /** Share of bright pixels (> 120). */
  bright: number;
  /** Rows that jump between the background and something clearly lighter or darker at least 6 times: lines of text. */
  textRows: number;
  /** Share of pixels close to the most common grey (an even background, of any colour). */
  even: number;
  /** Share of pixels clearly lighter or darker than that background. */
  contrast: number;
  /** Rows with many narrow strokes (letters), and how many separate lines of text they form. */
  strokeRows: number;
  lines: number;
  /** Mean grey of an 8×8 grid over the frame, to compare two frames. */
  grid: number[];
}

const DARK = 50;
const BRIGHT = 120;
const TEXT_TRANSITIONS = 6;
/** Pixels this much lighter or darker than the background are text (or something else on it). */
const CONTRAST = 60;
/** A pixel standing out this much from the pixels 3 to its left and right is part of a narrow stroke. */
const STROKE = 50;
const STROKE_REACH = 3;
const STROKES_PER_ROW = 6;
const GRID = 8;

export function frameStats(gray: Uint8Array, t: number, w = FRAME_W, h = FRAME_H): FrameStats {
  let sum = 0;
  let dark = 0;
  let bright = 0;
  const hist = new Uint32Array(32);
  const cells = new Float64Array(GRID * GRID);
  const cellCount = new Uint32Array(GRID * GRID);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const gy = Math.floor((y * GRID) / h) * GRID;
    for (let x = 0; x < w; x++) {
      const v = gray[row + x];
      sum += v;
      if (v < DARK) dark++;
      if (v > BRIGHT) bright++;
      hist[v >> 3]++;
      const c = gy + Math.floor((x * GRID) / w);
      cells[c] += v;
      cellCount[c]++;
    }
  }
  // The background: the most common grey, give or take one bin on either side.
  let best = 0;
  let bestCount = -1;
  for (let b = 0; b < 32; b++) {
    const n = hist[b] + (b > 0 ? hist[b - 1] : 0) + (b < 31 ? hist[b + 1] : 0);
    if (n > bestCount) {
      bestCount = n;
      best = b;
    }
  }
  const bg = best * 8 + 4;
  let contrast = 0;
  let textRows = 0;
  let strokeRows = 0;
  const strokeRow = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let transitions = 0;
    let wasOff = false;
    let strokes = 0;
    let inStroke = false;
    for (let x = 0; x < w; x++) {
      const v = gray[row + x];
      const off = Math.abs(v - bg) > CONTRAST;
      if (off) contrast++;
      if (off && !wasOff) transitions++;
      wasOff = off;
      if (x >= STROKE_REACH && x < w - STROKE_REACH) {
        const l = gray[row + x - STROKE_REACH];
        const r = gray[row + x + STROKE_REACH];
        const peak = v - Math.max(l, r) > STROKE || Math.min(l, r) - v > STROKE;
        if (peak && !inStroke) strokes++;
        inStroke = peak;
      }
    }
    if (transitions >= TEXT_TRANSITIONS) textRows++;
    if (strokes >= STROKES_PER_ROW) {
      strokeRows++;
      strokeRow[y] = 1;
    }
  }
  // Lines of text: runs of stroke rows a few pixels high (a gap of one row allowed).
  let lines = 0;
  let inLines = 0;
  for (let y = 0; y < h; ) {
    if (!strokeRow[y]) {
      y++;
      continue;
    }
    let end = y;
    while (end + 1 < h && (strokeRow[end + 1] || (end + 2 < h && strokeRow[end + 2]))) end++;
    let rows = 0;
    for (let k = y; k <= end; k++) rows += strokeRow[k];
    const height = end - y + 1;
    if (height >= 2 && height <= 16) {
      lines++;
      inLines += rows;
    }
    y = end + 1;
  }
  const n = w * h;
  return {
    t,
    mean: sum / n,
    dark: dark / n,
    bright: bright / n,
    textRows,
    even: bestCount / n,
    contrast: contrast / n,
    strokeRows,
    lines: strokeRows && inLines / strokeRows >= 0.7 ? lines : 0,
    grid: Array.from(cells, (c, i) => Math.round(c / Math.max(1, cellCount[i]))),
  };
}

export function classify(s: FrameStats): FrameKind {
  if (s.mean < 20 && s.bright < 0.002) return 'black';
  // An even background with a little content arranged in lines: text on a card (any colour).
  if (s.even >= 0.72 && s.contrast >= 0.002 && s.contrast <= 0.25 && s.textRows >= 3) return 'credits';
  // A few lines of narrow strokes over the picture; a busy picture has strokes in nearly every row.
  if (s.lines >= 2 && s.strokeRows >= 4 && s.strokeRows <= FRAME_H * 0.3) return 'overlay';
  return 'scene';
}

/** How different two frames look: mean difference of their grids (0–255). */
export function frameDiff(a: FrameStats, b: FrameStats): number {
  let d = 0;
  for (let i = 0; i < a.grid.length; i++) d += Math.abs(a.grid[i] - b.grid[i]);
  return d / Math.max(1, a.grid.length);
}

export interface VisualCredits {
  start: number;
  end: number;
  /** A scene after the credits (never skipped). */
  postCredits: { start: number; end: number } | null;
  confidence: 'high' | 'medium';
  /** Text on an even background, or over the picture (less certain: never trusted over a sure audio match). */
  kind: 'card' | 'overlay';
}

const MIN_CREDITS_SEC = 20;
const POST_CREDITS_MIN_SEC = 15;
/** A scene frame this short inside the credits (a logo, a still) does not end them. */
const MAX_INTERRUPTION_SEC = 6;
/** Black before the first credits frame that still belongs to them (a fade). */
const MAX_FADE_SEC = 5;

/**
 * The end credits in a series of frames (sorted by time): the last long stretch of credits and
 * black frames. What follows it is either the end of the file or a scene after the credits.
 */
export function findCredits(frames: FrameStats[], duration: number): VisualCredits | null {
  if (frames.length < 3) return null;
  const kinds = frames.map(classify);
  // Cards first: the clearest sign. Only without them, text over the picture.
  return creditsOf(frames, kinds.map((k) => (k === 'overlay' ? 'scene' : k)), duration, 'card') ?? creditsOf(frames, kinds.map((k) => (k === 'overlay' ? 'credits' : k)), duration, 'overlay');
}

/** Credits over the picture must run longer and be text most of the time. */
const OVERLAY_MIN_SEC = 30;
const OVERLAY_SHARE = 0.7;

function creditsOf(frames: FrameStats[], kinds: FrameKind[], duration: number, kind: VisualCredits['kind']): VisualCredits | null {
  const step = (i: number) => (i + 1 < frames.length ? frames[i + 1].t - frames[i].t : Math.max(0.5, duration - frames[i].t));
  // Blocks of credits/black frames, allowing short interruptions.
  const blocks: { from: number; to: number; credits: number; other: number }[] = [];
  let cur: { from: number; to: number; credits: number; other: number } | null = null;
  let sceneSince = -1;
  for (let i = 0; i < frames.length; i++) {
    const k = kinds[i];
    if (k === 'scene') {
      if (cur) {
        if (sceneSince < 0) sceneSince = i;
        if (frames[i].t + step(i) - frames[sceneSince].t > MAX_INTERRUPTION_SEC) {
          blocks.push(cur);
          cur = null;
          sceneSince = -1;
        }
      }
      continue;
    }
    if (!cur) cur = { from: i, to: i, credits: 0, other: 0 };
    if (sceneSince >= 0) cur.other += i - sceneSince;
    sceneSince = -1;
    cur.to = i;
    if (k === 'credits') cur.credits++;
  }
  if (cur) blocks.push(cur);

  for (let b = blocks.length - 1; b >= 0; b--) {
    const block = blocks[b];
    // The credits start at the first frame with text; black before it only counts as a short fade
    // (a long dark stretch is more likely the last scene).
    const firstText = kinds.findIndex((k, i) => i >= block.from && k === 'credits');
    if (firstText < 0 || firstText > block.to) continue;
    let from = firstText;
    while (from > block.from && kinds[from - 1] === 'black' && frames[firstText].t - frames[from - 1].t <= MAX_FADE_SEC) from--;
    const start = frames[from].t;
    const end = Math.min(duration, frames[block.to].t + step(block.to));
    const creditFrames = block.credits;
    const share = creditFrames / (block.to - from + 1);
    if (end - start < MIN_CREDITS_SEC || creditFrames < 4 || share < 0.5) continue;
    if (kind === 'overlay' && (end - start < OVERLAY_MIN_SEC || share < OVERLAY_SHARE)) continue;
    const confidence = kind === 'card' && end - start >= 30 && share >= 0.7 ? 'high' : 'medium';
    // Real content after the credits is a scene; a few seconds of logos or black are not.
    const after = frames.filter((_, i) => i > block.to && kinds[i] === 'scene');
    const tail = duration - end;
    if (after.length >= 2 && tail >= POST_CREDITS_MIN_SEC) return { start: round(start), end: round(end), postCredits: { start: round(end), end: round(duration) }, confidence, kind };
    return { start: round(start), end: round(duration), postCredits: null, confidence, kind };
  }
  return null;
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Keyframes can be seconds apart, so the found start is refined with every frame around it (a
 * second pass at 2 frames per second): the credits start right after the last scene frame.
 */
export function refineStart(frames: FrameStats[], coarse: number, kind: VisualCredits['kind'] = 'card'): number {
  let lastScene = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].t > coarse + 3) break;
    const k = classify(frames[i]);
    if (k === 'scene' || (k === 'overlay' && kind === 'card')) lastScene = i;
  }
  if (lastScene < 0 || lastScene + 1 >= frames.length) return coarse;
  return round(Math.min(coarse, frames[lastScene + 1].t));
}

/** Frames this alike (grid difference) show the same picture: the intro in two episodes. */
const SAME_PICTURE = 16;
/** How far the two episodes may be out of step around the edge, in seconds. */
const MAX_SHIFT_SEC = 4;
const SHIFT_STEP_SEC = 0.25;
/** The picture may move the edge this far beyond the audio (skipping more); never further. */
export const EDGE_GROW_SEC = 3;
/** At least this many matching frames that are not black: black looks the same everywhere. */
const MIN_MATCHING = 3;
/** Frames taken as surely inside the intro, this far from the edge the audio gave (the first that works). */
const INSIDE_SEC = [3, 5];

/**
 * Where the intro starts (or ends) in the picture. `own` are dense frames around this episode's
 * edge (from the audio), `peer` the same around another episode's edge (`peerEdge`). The intro looks the same
 * in both; the scene before (or after) it does not. The two are lined up at the shift where the
 * most frames on the intro side match, and the edge is where that run of matching frames stops.
 * Null when the picture does not settle it (no match, black only, or the run reaches the window).
 */
export function pictureEdge(own: FrameStats[], edge: number, peer: FrameStats[], peerEdge: number, side: 'start' | 'end'): number | null {
  if (own.length < 4 || peer.length < 4) return null;
  // A frame surely inside the intro; further in when the audio ran on past the picture.
  for (const into of INSIDE_SEC) {
    const found = edgeFrom(own, edge, peer, peerEdge, side, side === 'start' ? edge + into : edge - into);
    if (found !== null) return found;
  }
  return null;
}

function edgeFrom(own: FrameStats[], edge: number, peer: FrameStats[], peerEdge: number, side: 'start' | 'end', inside: number): number | null {
  let anchor = 0;
  for (let i = 1; i < own.length; i++) if (Math.abs(own[i].t - inside) < Math.abs(own[anchor].t - inside)) anchor = i;
  if (Math.abs(own[anchor].t - inside) > 0.5) return null;
  let best: { from: number; to: number; score: number; cost: number } | null = null;
  for (let d = -MAX_SHIFT_SEC; d <= MAX_SHIFT_SEC + 1e-9; d += SHIFT_STEP_SEC) {
    const peerAt = peerIndexer(peer, peerEdge - edge + d);
    const diffs = own.map((f) => {
      const p = peerAt(f.t);
      return p ? frameDiff(f, p) : Infinity;
    });
    if (!(diffs[anchor] <= SAME_PICTURE)) continue;
    let from = anchor;
    let to = anchor;
    while (from > 0 && diffs[from - 1] <= SAME_PICTURE) from--;
    while (to + 1 < own.length && diffs[to + 1] <= SAME_PICTURE) to++;
    let score = 0;
    let cost = 0;
    for (let i = from; i <= to; i++) {
      if (classify(own[i]) !== 'black') score++;
      cost += diffs[i];
    }
    if (score < MIN_MATCHING) continue;
    if (!best || score > best.score || (score === best.score && cost < best.cost)) best = { from, to, score, cost };
  }
  if (!best) return null;
  if (side === 'start') {
    if (best.from === 0) return null;
    const at = (own[best.from - 1].t + own[best.from].t) / 2;
    return round(Math.max(at, edge - EDGE_GROW_SEC));
  }
  if (best.to === own.length - 1) return null;
  const at = (own[best.to].t + own[best.to + 1].t) / 2;
  return round(Math.min(at, edge + EDGE_GROW_SEC));
}

/** The peer frame shown at `t + shift`, when one lies close enough. */
function peerIndexer(peer: FrameStats[], shift: number) {
  return (t: number): FrameStats | null => {
    const want = t + shift;
    let lo = 0;
    let hi = peer.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (peer[mid].t < want) lo = mid + 1;
      else hi = mid;
    }
    let best = peer[lo];
    if (lo > 0 && Math.abs(peer[lo - 1].t - want) < Math.abs(best.t - want)) best = peer[lo - 1];
    return Math.abs(best.t - want) <= 0.3 ? best : null;
  };
}
