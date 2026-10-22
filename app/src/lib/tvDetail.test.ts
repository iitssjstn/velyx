import { describe, expect, it } from 'vitest';
import { episodeFacts, startEpisode } from './tvDetail';
import type { EpisodeSummary } from './types';

const ep = (id: number, extra: Partial<EpisodeSummary> = {}): EpisodeSummary => ({ id, seasonNumber: 1, episodeNumber: id, title: null, overview: null, runtime: null, stillPath: null, durationSec: null, progress: null, ...extra });

describe('episodeFacts', () => {
  it('shows the code and the length', () => {
    expect(episodeFacts(ep(2, { runtime: 52 }))).toMatch(/^S01E02 · /);
  });
  it('uses the file length without a runtime, and only the code without either', () => {
    expect(episodeFacts(ep(3, { durationSec: 3000 }))).toMatch(/^S01E03 · /);
    expect(episodeFacts(ep(4))).toBe('S01E04');
  });
});

describe('startEpisode', () => {
  const list = [ep(10), ep(11), ep(12)];
  it('starts at the episode to watch next', () => {
    expect(startEpisode(list, 12)).toBe(2);
  });
  it('starts at the first when the next one is in another season or unknown', () => {
    expect(startEpisode(list, 99)).toBe(0);
    expect(startEpisode(list, null)).toBe(0);
    expect(startEpisode([], 5)).toBe(0);
  });
});
