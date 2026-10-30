import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { AUDIO_MODES, audioMenuPick } from './audioMode';
import { problemsFor, REPORT_KINDS, reportBody, reportLine, reportOutcome, reportPath } from './segmentReport';

describe('reporting a recap, intro or credits that is not right', () => {
  it('offers the problems that fit a part that was found, and "missing" for one that was not', () => {
    expect(problemsFor(true)).toEqual(['starts-early', 'starts-late', 'ends-early', 'ends-late', 'not-there']);
    expect(problemsFor(false)).toEqual(['missing']);
    expect(REPORT_KINDS).toEqual(['recap', 'intro', 'credits']);
  });

  it('builds the body with the position rounded, and leaves out a position that is not a time', () => {
    expect(reportBody('intro', 'ends-early', 93.456)).toEqual({ kind: 'intro', problem: 'ends-early', position: 93.5 });
    expect(reportBody('credits', 'missing')).toEqual({ kind: 'credits', problem: 'missing' });
    expect(reportBody('recap', 'not-there', Number.NaN)).toEqual({ kind: 'recap', problem: 'not-there' });
    expect(reportBody('recap', 'not-there', -1)).toEqual({ kind: 'recap', problem: 'not-there' });
    expect(reportPath(42)).toBe('/api/episodes/42/segment-report');
  });

  it('tells "too many" apart from other failures', () => {
    expect(reportOutcome(null)).toBe('sent');
    expect(reportOutcome(new ApiError('Too many', 429))).toBe('tooMany');
    expect(reportOutcome(new ApiError('Nope', 500))).toBe('failed');
    expect(reportOutcome(new Error('offline'))).toBe('failed');
  });

  it('puts the report on the TV as the last line of the Audio tab, after tracks and audio modes, for an episode only', () => {
    const line = reportLine(2, true);
    expect(line).toBe(2 + AUDIO_MODES.length);
    // The audio choices before it still pick what they did.
    expect(audioMenuPick(line - 1, 2)).toEqual({ kind: 'mode', mode: AUDIO_MODES[AUDIO_MODES.length - 1] });
    expect(audioMenuPick(line, 2)).toBeNull();
    expect(reportLine(2, false)).toBe(-1);
  });
});
