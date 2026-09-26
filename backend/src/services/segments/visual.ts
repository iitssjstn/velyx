/**
 * Recognising end credits in the picture: frames that are mostly dark with lines of small, bright
 * text (standing still or scrolling). Works on small grayscale frames (320×180) decoded from the
 * last minutes of an episode, so it also finds credits whose music differs every episode.
 * Pure functions; decoding is done by the detector service.
 */

export const FRAME_W = 320;
export const FRAME_H = 180;

export type FrameKind = 'credits' | 'black' | 'scene';

export interface FrameStats {
  /** Seconds from the start of the file. */
  t: number;
  /** Mean brightness 0–255. */
  mean: number;
  /** Share of dark pixels (< 50). */
  dark: number;
  /** Share of bright pixels (> 120). */
  bright: number;
  /** Rows that cross from dark to bright at least 6 times: lines of text. */
  textRows: number;
}

const DARK = 50;
const BRIGHT = 120;
const TEXT_TRANSITIONS = 6;

export function frameStats(gray: Uint8Array, t: number, w = FRAME_W, h = FRAME_H): FrameStats {
  let sum = 0;
  let dark = 0;
  let bright = 0;
  let textRows = 0;
  for (let y = 0; y < h; y++) {
    let transitions = 0;
    let wasBright = false;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const v = gray[row + x];
      sum += v;
      if (v < DARK) dark++;
      const isBright = v > BRIGHT;
      if (isBright) bright++;
      if (isBright && !wasBright) transitions++;
      wasBright = isBright;
    }
    if (transitions >= TEXT_TRANSITIONS) textRows++;
  }
  const n = w * h;
  return { t, mean: sum / n, dark: dark / n, bright: bright / n, textRows };
}

export function classify(s: FrameStats): FrameKind {
  if (s.mean < 20 && s.bright < 0.002) return 'black';
  // Dark picture, a little bright content, arranged in lines: text on a dark background.
  if (s.dark >= 0.72 && s.bright >= 0.002 && s.bright <= 0.25 && s.textRows >= 3) return 'credits';
  return 'scene';
}

export interface VisualCredits {
  start: number;
  end: number;
  /** A scene after the credits (never skipped). */
  postCredits: { start: number; end: number } | null;
  confidence: 'high' | 'medium';
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
    const confidence = end - start >= 30 && share >= 0.7 ? 'high' : 'medium';
    // Real content after the credits is a scene; a few seconds of logos or black are not.
    const after = frames.filter((f, i) => i > block.to && kinds[i] === 'scene');
    const tail = duration - end;
    if (after.length >= 2 && tail >= POST_CREDITS_MIN_SEC) return { start: round(start), end: round(end), postCredits: { start: round(end), end: round(duration) }, confidence };
    return { start: round(start), end: round(duration), postCredits: null, confidence };
  }
  return null;
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Keyframes can be seconds apart, so the found start is refined with every frame around it (a
 * second pass at 2 frames per second): the credits start right after the last scene frame.
 */
export function refineStart(frames: FrameStats[], coarse: number): number {
  let lastScene = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].t > coarse + 3) break;
    if (classify(frames[i]) === 'scene') lastScene = i;
  }
  if (lastScene < 0 || lastScene + 1 >= frames.length) return coarse;
  return round(Math.min(coarse, frames[lastScene + 1].t));
}
