import { ApiError } from './api';
import { AUDIO_MODES } from './audioMode';

/**
 * A viewer telling that a recap, intro or credits is not right ("Intro klopt niet"). The server
 * passes it on to vidalune.com, where Vidalune can correct it for everyone.
 */
export const REPORT_KINDS = ['recap', 'intro', 'credits'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_PROBLEMS = ['starts-early', 'starts-late', 'ends-early', 'ends-late', 'not-there', 'missing'] as const;
export type ReportProblem = (typeof REPORT_PROBLEMS)[number];

export interface SegmentReport {
  kind: ReportKind;
  problem: ReportProblem;
  position?: number;
}

/** What can be wrong with a part: a part that was found can be placed wrong or not be there at all; one that was not found is missing. */
export function problemsFor(found: boolean): ReportProblem[] {
  return found ? ['starts-early', 'starts-late', 'ends-early', 'ends-late', 'not-there'] : ['missing'];
}

/** The body sent to the server; the position (where the viewer is now) only when it is a real time. */
export function reportBody(kind: ReportKind, problem: ReportProblem, position?: number): SegmentReport {
  const body: SegmentReport = { kind, problem };
  if (typeof position === 'number' && Number.isFinite(position) && position >= 0) body.position = Math.round(position * 10) / 10;
  return body;
}

export const reportPath = (episodeId: number | string) => `/api/episodes/${episodeId}/segment-report`;

/** How sending went: sent, too many reports in a short time (429), or failed otherwise. */
export function reportOutcome(err: unknown): 'sent' | 'tooMany' | 'failed' {
  if (err === null || err === undefined) return 'sent';
  return err instanceof ApiError && err.status === 429 ? 'tooMany' : 'failed';
}

/**
 * On the TV the report is the last line of the Audio tab, after the file's tracks and the audio
 * modes (the tab is always there). The index of that line, or -1 when there is none (a movie).
 */
export function reportLine(audioTracks: number, episode: boolean): number {
  return episode ? audioTracks + AUDIO_MODES.length : -1;
}
