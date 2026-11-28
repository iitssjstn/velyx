/**
 * End credits of a movie. A movie has no other episodes to compare its audio with, so only two
 * sources count: chapter markers named like credits, and credits in the picture of the closing
 * part. Pure functions; reading the file is done by the detector.
 */
import type { ChapterSegments } from './chapters.js';
import type { VisualCredits } from './visual.js';

/** Bump to look at every movie again. */
export const MOVIE_DETECTION_VERSION = 1;

/** Movies shorter than this are not analysed (shorts, trailers, extras). */
export const MOVIE_MIN_SEC = 20 * 60;

/** Closing part read for credits: the last 20 minutes (at most a quarter of the movie). */
export function movieTailWindow(duration: number): { start: number; end: number } {
  const len = Math.min(20 * 60, duration * 0.25);
  return { start: Math.max(0, duration - len), end: duration };
}

export interface MovieCredits {
  start: number;
  end: number;
  confidence: 'high' | 'medium';
  source: 'chapters' | 'video';
  postCredits: { start: number; end: number } | null;
}

/** Credits that start earlier than this share of the movie are not credits (a sign, a letter). */
const EARLIEST_SHARE = 0.7;
const MIN_LENGTH_SEC = 20;

export function movieCredits(chapters: ChapterSegments | null, visual: VisualCredits | null, duration: number): MovieCredits | null {
  const plausible = (s: { start: number; end: number }) => s.start >= duration * EARLIEST_SHARE && s.end - s.start >= MIN_LENGTH_SEC;
  if (chapters?.credits && plausible(chapters.credits)) {
    return { ...round(chapters.credits), confidence: 'high', source: 'chapters', postCredits: chapters.postCredits ? round(chapters.postCredits) : null };
  }
  if (visual && plausible(visual)) {
    return { ...round(visual), confidence: visual.confidence, source: 'video', postCredits: visual.postCredits ? round(visual.postCredits) : null };
  }
  return null;
}

const round = (s: { start: number; end: number }) => ({ start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10 });
