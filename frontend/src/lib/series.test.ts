import { describe, expect, it } from 'vitest';
import { episodeHeading, episodePlayHref, episodeState, seriesContinue } from './series';

const ep = { id: 7, seasonNumber: 2, episodeNumber: 4, title: 'The Beginning', progress: null };

describe('series helpers', () => {
  it('names episodes by code and title', () => {
    expect(episodeHeading(ep)).toBe('S02E04 · The Beginning');
    expect(episodeHeading({ ...ep, title: null })).toBe('S02E04');
  });

  it('knows whether an episode is watched, in progress or new', () => {
    expect(episodeState(ep)).toEqual({ kind: 'new', percent: 0 });
    expect(episodeState({ progress: { positionSec: 1934, durationSec: 2844, completed: false } })).toEqual({ kind: 'progress', percent: 68 });
    expect(episodeState({ progress: { positionSec: 10, durationSec: 2844, completed: false } }).kind).toBe('new');
    expect(episodeState({ progress: { positionSec: 0, durationSec: 2844, completed: true } })).toEqual({ kind: 'watched', percent: 100 });
  });

  it('plays or resumes straight from the list', () => {
    expect(episodePlayHref(ep)).toBe('/play/episode/7?t=0');
    expect(episodePlayHref({ ...ep, progress: { positionSec: 1934, durationSec: 2844, completed: false } })).toBe('/play/episode/7?t=1934');
  });

  it('picks the main button: resume, play next, play, or watch again', () => {
    const up = { id: 9, seasonNumber: 2, episodeNumber: 4, title: 'The Beginning', durationSec: 2901, progress: null };
    expect(seriesContinue({ upNext: null, watchedCount: 0, episodeCount: 0 })).toBeNull();
    expect(seriesContinue({ upNext: up, watchedCount: 0, episodeCount: 10 })).toMatchObject({ label: 'Play S02E04', href: '/play/episode/9?t=0', startOverHref: null });
    expect(seriesContinue({ upNext: up, watchedCount: 3, episodeCount: 10 })?.label).toBe('Play next S02E04');
    expect(seriesContinue({ upNext: up, watchedCount: 10, episodeCount: 10 })?.label).toBe('Watch again from S02E04');
    expect(seriesContinue({ upNext: { ...up, progress: { positionSec: 1934, durationSec: 2901, completed: false } }, watchedCount: 3, episodeCount: 10 })).toEqual({
      label: 'Resume S02E04',
      href: '/play/episode/9?t=1934',
      startOverHref: '/play/episode/9?t=0',
      position: '32:14 / 48:21',
    });
  });
});
