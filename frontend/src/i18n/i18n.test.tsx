import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { en } from './en/index';
import { nl } from './nl/index';
import { currentLanguage, initialLanguage, languageLabel, setLanguage, t, useT, type MessageKey, type Plural } from './index';

afterEach(async () => {
  await setLanguage('en');
  localStorage.clear();
});

type Tree = { [k: string]: string | Plural | Tree };
function leaves(tree: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([k, v]) => {
    if (typeof v === 'string') return [[prefix + k, v] as [string, string]];
    if ('one' in v && 'other' in v && typeof v.one === 'string') return [[`${prefix}${k}.one`, v.one as string], [`${prefix}${k}.other`, v.other as string]] as Array<[string, string]>;
    return leaves(v as Tree, `${prefix}${k}.`);
  });
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Texts that are the same in Dutch on purpose: technical terms, product names and formats. */
const SAME_IN_DUTCH = new Set([
  'time.seconds', 'time.minutes', 'media.mono', 'media.stereo', 'series.special', 'series.specials', 'series.status.pilot', 'nav.menu',
  'settings.audio.surround', 'settings.device.containers', 'settings.server.title', 'settings.tabs.account', 'settings.tabs.server',
  'continueWatching.details', 'library.cast', 'player.volume', 'collections.itemCount.one', 'collections.itemCount.other', 'device.browser',
  'device.script', 'playback.directPlay', 'playback.remux', 'playback.remuxAudio', 'playback.video', 'playback.audio', 'playback.container',
  'mediaInfo.media', 'home.details', 'home.greeting', 'browse.genre', 'browse.filtersTitle', 'smart.builtIn.hdr', 'admin.tabs.dashboard',
  'admin.tabs.metadata', 'admin.tabs.server', 'dashboard.scanner', 'dashboard.phase.metadata', 'dashboard.database', 'dashboard.cpuVelyx',
  'dashboard.runtime', 'server.status', 'audit.groups.tmdb', 'segments.intro',
  'onlineSubs.hearingImpaired', 'onlineSubs.downloads.one', 'onlineSubs.downloads.other', 'onlineSubs.tag', 'playback.bitrate',
]);

describe('translations', () => {
  const english = new Map(leaves(en as unknown as Tree));
  const dutch = new Map(leaves(nl as unknown as Tree));

  it('Dutch has every English text, with the same placeholders, and none empty', () => {
    expect([...english.keys()].filter((k) => !dutch.has(k))).toEqual([]);
    expect([...dutch.keys()].filter((k) => !english.has(k))).toEqual([]);
    for (const [key, text] of english) {
      expect({ key, placeholders: placeholders(dutch.get(key)!) }).toEqual({ key, placeholders: placeholders(text) });
      expect(dutch.get(key)!.trim(), key).not.toBe('');
    }
  });

  it('leaves no English text untranslated, except technical terms', () => {
    const same = [...english].filter(([key, text]) => dutch.get(key) === text && !SAME_IN_DUTCH.has(key)).map(([key]) => key);
    expect(same).toEqual([]);
  });

  it('uses consistent Dutch terms', async () => {
    await setLanguage('nl');
    const terms: Array<[MessageKey, string]> = [
      ['nav.movies', 'Films'],
      ['nav.tvShows', 'Series'],
      ['series.episodes', 'Afleveringen'],
      ['series.seasons', 'Seizoenen'],
      ['continueWatching.title', 'Verder kijken'],
      ['home.recentlyAdded', 'Recent toegevoegd'],
      ['library.watched', 'Bekeken'],
      ['library.unwatched', 'Onbekeken'],
      ['nav.settings', 'Instellingen'],
      ['common.search', 'Zoeken'],
      ['playback.subtitles', 'Ondertiteling'],
      ['playback.audio', 'Audio'],
      ['settings.playback.title', 'Afspelen'],
      ['health.library', 'Bibliotheek'],
    ];
    for (const [key, expected] of terms) expect(t(key)).toBe(expected);
  });
});

describe('t', () => {
  it('fills in placeholders and picks singular or plural', async () => {
    expect(t('series.episodeCount', { count: 1 })).toBe('1 episode');
    expect(t('series.episodeCount', { count: 12 })).toBe('12 episodes');
    expect(t('library.watchedOf', { watched: 3, total: 10 })).toBe('3 of 10 watched');
    await setLanguage('nl');
    expect(t('series.episodeCount', { count: 1 })).toBe('1 aflevering');
    expect(t('series.episodeCount', { count: 0 })).toBe('0 afleveringen');
    // Numbers are written the Dutch way.
    expect(t('browse.movieCount', { count: 1234 })).toBe('1.234 films');
  });

  it('switches language at once, and remembers it on this device', async () => {
    expect(currentLanguage()).toBe('en');
    await setLanguage('nl');
    expect(currentLanguage()).toBe('nl');
    expect(document.documentElement.lang).toBe('nl');
    expect(localStorage.getItem('velyx.language')).toBe('nl');
    expect(initialLanguage()).toBe('nl');
  });

  it('starts in the browser language when Velyx has it, otherwise English', () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
    const setLanguages = (list: string[]) => Object.defineProperty(navigator, 'languages', { value: list, configurable: true });
    try {
      setLanguages(['nl-NL', 'en']);
      expect(initialLanguage()).toBe('nl');
      setLanguages(['de-DE', 'fr']);
      expect(initialLanguage()).toBe('en');
      // An explicit choice on this device wins over the browser.
      localStorage.setItem('velyx.language', 'en');
      setLanguages(['nl-NL']);
      expect(initialLanguage()).toBe('en');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).languages;
      if (original) Object.defineProperty(Navigator.prototype, 'languages', original);
    }
  });

  it('names audio and subtitle languages in the interface language', async () => {
    expect(languageLabel('eng')).toBe('English');
    expect(languageLabel('nld')).toBe('Dutch');
    await setLanguage('nl');
    expect(languageLabel('eng')).toBe('Engels');
    expect(languageLabel('de')).toBe('Duits');
    expect(languageLabel('und')).toBeNull();
    expect(languageLabel(null)).toBeNull();
  });
});

describe('useT', () => {
  it('updates what is on screen without remounting anything', async () => {
    let mounts = 0;
    function Probe() {
      const { t } = useT();
      useEffect(() => {
        mounts++;
      }, []);
      return <p>{t('player.nextEpisode')}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('Next episode')).toBeTruthy();
    await act(() => setLanguage('nl'));
    expect(screen.getByText('Volgende aflevering')).toBeTruthy();
    await act(() => setLanguage('en'));
    expect(screen.getByText('Next episode')).toBeTruthy();
    expect(mounts).toBe(1);
  });
});
