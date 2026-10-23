import { describe, expect, it } from 'vitest';
import { continueLine } from './continue';
import { translator } from './i18n';
import type { ContinueItem } from './types';

const t = translator('en');
const base: ContinueItem = { type: 'episode', id: 1, title: 'Breaking Bad', subtitle: "S1 E2 · Cat's in the Bag...", imagePath: null, posterPath: null, showId: 1, seasonNumber: 1, episodeNumber: 2, episodeTitle: "Cat's in the Bag...", upNext: false, progress: null, percent: 0 };

describe('continueLine', () => {
  it('names the episode once', () => {
    expect(continueLine(base, t)).toBe("S1 E2 · Cat's in the Bag...");
  });
  it('says up next once, in the app language', () => {
    expect(continueLine({ ...base, upNext: true, subtitle: 'Next: S1 E2 · Jigsaw Puzzle', episodeTitle: 'Jigsaw Puzzle' }, t)).toBe('Up next · S1 E2 · Jigsaw Puzzle');
    expect(continueLine({ ...base, upNext: true, episodeTitle: null }, translator('nl'))).toBe('Hierna · S1 E2');
  });
  it('keeps a movie its year', () => {
    expect(continueLine({ ...base, type: 'movie', subtitle: '2019', seasonNumber: null, episodeNumber: null, episodeTitle: null }, t)).toBe('2019');
  });
});
