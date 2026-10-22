import { describe, expect, it } from 'vitest';
import { aboutFacts, factLine, episodeFacts, initials, startEpisode } from './tvDetail';
import { translator } from './i18n';
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

describe('aboutFacts', () => {
  const t = translator('en');
  it('lists genres, makers, network and a different original title', () => {
    const facts = aboutFacts(
      { title: 'Haus des Geldes', originalTitle: 'La casa de papel', genres: [{ name: 'Crime' }, { name: 'Drama' }], network: 'Antena 3', crew: [{ name: 'Álex Pina', role: 'Creator' }, { name: 'Someone', role: 'Producer' }] },
      t,
    );
    expect(facts).toEqual([
      { label: 'Genres', value: 'Crime, Drama' },
      { label: 'Created by', value: 'Álex Pina' },
      { label: 'Network', value: 'Antena 3' },
      { label: 'Original title', value: 'La casa de papel' },
    ]);
  });
  it('shows the director of a movie and leaves out what is missing or the same', () => {
    expect(aboutFacts({ title: 'Heat', originalTitle: 'Heat', genres: [], director: 'Michael Mann' }, t)).toEqual([{ label: 'Director', value: 'Michael Mann' }]);
    expect(aboutFacts({ title: 'X', genres: [] }, t)).toEqual([]);
  });
});

describe('initials', () => {
  it('takes the first letters of two names', () => {
    expect(initials('Cillian Murphy')).toBe('CM');
    expect(initials('helen  mirren jr')).toBe('HM');
    expect(initials('Zendaya')).toBe('Z');
  });
});

describe('factLine', () => {
  it('joins the facts under a title with dots and leaves out empty ones', () => {
    expect(factLine(['2h 18m', null, '★ 7.4', '', undefined, false, 'Drama, Crime'])).toBe('2h 18m • ★ 7.4 • Drama, Crime');
    expect(factLine([3, 'AMC'])).toBe('3 • AMC');
    expect(factLine([])).toBe('');
  });
});
