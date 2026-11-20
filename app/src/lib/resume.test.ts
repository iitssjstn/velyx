import { describe, expect, it } from 'vitest';
import { resumeHref, startChoice } from './resume';

const halfway = { positionSec: 1200, durationSec: 3600 };

describe('where a title starts', () => {
  it('asks to resume or start over when it was opened without saying', () => {
    expect(startChoice({ startAt: null, resume: false, following: false, progress: halfway })).toEqual({ ask: true, at: 1200 });
  });
  it('resumes without asking from Continue watching and the Resume buttons', () => {
    expect(startChoice({ startAt: null, resume: true, following: false, progress: halfway })).toEqual({ ask: false, at: 1200 });
    expect(resumeHref('episode', 7)).toBe('/play/episode/7?resume=1');
  });
  it('starts where it was asked to', () => {
    expect(startChoice({ startAt: 0, resume: false, following: false, progress: halfway })).toEqual({ ask: false, at: 0 });
    expect(startChoice({ startAt: 300, resume: true, following: false, progress: halfway })).toEqual({ ask: false, at: 300 });
  });
  it('does not ask without a point to resume from', () => {
    expect(startChoice({ startAt: null, resume: false, following: false, progress: null })).toEqual({ ask: false, at: 0 });
    expect(startChoice({ startAt: null, resume: false, following: false, progress: { positionSec: 10, durationSec: 3600 } })).toEqual({ ask: false, at: 0 });
  });
  it('does not ask for a title a TV or phone already plays', () => {
    expect(startChoice({ startAt: null, resume: false, following: true, progress: halfway })).toEqual({ ask: false, at: 1200 });
  });
});
