import type { EpisodeSegments, Part } from './adminPages';

/** The parts an admin can set by hand, in the order of the episode. */
export const EDIT_PARTS = ['recap', 'intro', 'credits', 'postCredits'] as const;
export type EditPart = (typeof EDIT_PARTS)[number];

export interface TimePair {
  start: string;
  end: string;
}
export type EditValues = Record<EditPart, TimePair>;
export type Span = { start: number; end: number } | null;
/** Body of `PUT /api/admin/segments/episodes/:id`: null means "none". */
export type EditBody = Record<EditPart, Span>;

export type EditProblem =
  | { key: 'segmentEdit.enterTimes'; part: EditPart }
  | { key: 'segmentEdit.endAfterStart'; part: EditPart }
  | { key: 'segmentEdit.afterEpisode'; part: EditPart; length: string }
  | { key: 'segmentEdit.recapBeforeIntro' | 'segmentEdit.introBeforeCredits' | 'segmentEdit.postAfterCredits'; part: EditPart };

/** "83", "1:23", "1:23.5" or "1:02:03" in seconds; null when it is not a time. */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$|^\d+:[0-5]?\d(\.\d+)?$|^\d+:[0-5]?\d:[0-5]?\d(\.\d+)?$/.test(t)) return null;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** 1:05, 1:02:03, or 1:05.4 when there are tenths (so saving again does not move a time). */
export function formatTime(seconds: number): string {
  const tenths = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10);
  const whole = Math.floor(tenths / 10);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const sec = String(whole % 60).padStart(2, '0');
  const frac = tenths % 10 ? `.${tenths % 10}` : '';
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}${frac}` : `${m}:${sec}${frac}`;
}

const pair = (p: Part | null | undefined): TimePair => (p ? { start: formatTime(p.start), end: formatTime(p.end) } : { start: '', end: '' });

/** The fields filled with what is stored now. */
export function initialValues(s: EpisodeSegments | null | undefined): EditValues {
  return { recap: pair(s?.recap), intro: pair(s?.intro), credits: pair(s?.credits), postCredits: pair(s?.postCredits) };
}

/** Parts that come from Vidalune (`central`): they go before a correction made here. */
export function centralParts(s: EpisodeSegments | null | undefined): EditPart[] {
  if (!s) return [];
  return EDIT_PARTS.filter((k) => s[k]?.source === 'central');
}

/**
 * Checks the fields and makes the request body. Both fields empty: "none". Same rules as the server,
 * so the admin sees what is wrong before sending.
 */
export function buildBody(values: EditValues, duration: number | null): { body: EditBody } | { problem: EditProblem } {
  const body = {} as EditBody;
  for (const part of EDIT_PARTS) {
    const v = values[part];
    if (!v.start.trim() && !v.end.trim()) {
      body[part] = null;
      continue;
    }
    const start = parseTime(v.start);
    const end = parseTime(v.end);
    if (start === null || end === null) return { problem: { key: 'segmentEdit.enterTimes', part } };
    if (end <= start) return { problem: { key: 'segmentEdit.endAfterStart', part } };
    if (duration && end > duration + 1) return { problem: { key: 'segmentEdit.afterEpisode', part, length: formatTime(Math.round(duration)) } };
    body[part] = { start, end };
  }
  const { recap, intro, credits, postCredits } = body;
  if (recap && intro && recap.end > intro.start + 1) return { problem: { key: 'segmentEdit.recapBeforeIntro', part: 'recap' } };
  if (intro && credits && intro.end > credits.start) return { problem: { key: 'segmentEdit.introBeforeCredits', part: 'intro' } };
  if (credits && postCredits && postCredits.start < credits.end) return { problem: { key: 'segmentEdit.postAfterCredits', part: 'postCredits' } };
  return { body };
}
