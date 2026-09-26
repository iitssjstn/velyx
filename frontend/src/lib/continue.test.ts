import { describe, expect, it } from 'vitest';
import { continueDetail, continuePosition, isStarted, resumeHref, startOverHref } from './continue';
import type { ContinueItem } from './types';

const base: ContinueItem = { type: 'episode', id: 9, title: 'Narcos', subtitle: 'S1 E3', imagePath: null, posterPath: null, showId: 2, seasonNumber: 1, episodeNumber: 3, episodeTitle: null, upNext: false, progress: { positionSec: 754, durationSec: 3120 }, percent: 24, updatedAt: 0 };

describe('Continue Watching labels', () => {
  it('describes episodes, specials, the next episode and movies', () => {
    expect(continueDetail(base)).toBe('Season 1 · Episode 3');
    expect(continueDetail({ ...base, seasonNumber: 0 })).toBe('Special 3');
    expect(continueDetail({ ...base, upNext: true })).toBe('Up next · Season 1 · Episode 3');
    expect(continueDetail({ ...base, type: 'movie', subtitle: '2021', seasonNumber: null, episodeNumber: null })).toBe('2021');
  });

  it('shows the position only while something is in progress', () => {
    expect(continuePosition(base)).toBe('12:34 / 52:00');
    expect(continuePosition({ ...base, progress: null })).toBeNull();
    expect(continuePosition({ ...base, progress: { positionSec: 0, durationSec: 3120 } })).toBeNull();
    expect(isStarted(base)).toBe(true);
    expect(isStarted({ ...base, progress: null })).toBe(false);
  });

  it('resumes at the saved position, or starts over without asking', () => {
    expect(resumeHref(base)).toBe('/play/episode/9?t=754');
    expect(resumeHref({ ...base, progress: null })).toBe('/play/episode/9');
    expect(startOverHref(base)).toBe('/play/episode/9?t=0');
  });
});
