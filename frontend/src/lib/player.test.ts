import { describe, expect, it } from 'vitest';
import { pickSubtitle, playHref, preferredAudioIndex, resumePoint, startPosition, subtitleName, withParam } from './player';
import { setLanguage } from '../i18n';
import { detectCapabilities } from './codecs';
import { normalizeLanguage, sameLanguage } from './prefs';
import type { SubtitleOption } from './types';

const sub = (key: string, language: string | null, extra: Partial<SubtitleOption> = {}): SubtitleOption => ({
  key,
  kind: 'external',
  label: key,
  language,
  forced: false,
  isDefault: false,
  url: `/x/${key}`,
  ...extra,
});

describe('startPosition', () => {
  it('prefers an explicit ?t= value', () => {
    expect(startPosition('0', { positionSec: 600, durationSec: 6000, completed: false })).toBe(0);
    expect(startPosition('120', null)).toBe(120);
  });
  it('resumes unfinished plays only', () => {
    expect(startPosition(null, { positionSec: 600, durationSec: 6000, completed: false })).toBe(600);
    // A finished play starts at the beginning (the server resets the position when it is finished).
    expect(startPosition(null, { positionSec: 0, durationSec: 6000, completed: true })).toBe(0);
    expect(startPosition(null, { positionSec: 10, durationSec: 6000, completed: false })).toBe(0);
    expect(startPosition(null, { positionSec: 5990, durationSec: 6000, completed: false })).toBe(0);
  });
  it('resumes a watched item that is being watched again', () => {
    expect(startPosition(null, { positionSec: 600, durationSec: 6000, completed: true })).toBe(600);
    // Positions at the end, as saved by older versions after a finished play, start over.
    expect(startPosition(null, { positionSec: 5500, durationSec: 6000, completed: true })).toBe(0);
    expect(resumePoint({ positionSec: 5400, durationSec: 6000 })).toBeNull();
    expect(resumePoint({ positionSec: 5399, durationSec: 6000 })).toBe(5399);
    expect(resumePoint(null)).toBeNull();
  });
});

describe('pickSubtitle', () => {
  const subs = [sub('nl-forced', 'nl', { forced: true }), sub('nl', 'dut'), sub('en', 'eng')];
  it('selects the preferred language, full track first', () => {
    expect(pickSubtitle(subs, 'nl')).toBe('nl');
    expect(pickSubtitle(subs, 'en')).toBe('en');
  });
  it('falls back to a default forced track or none', () => {
    expect(pickSubtitle(subs, '')).toBeNull();
    expect(pickSubtitle([sub('f', 'en', { forced: true, isDefault: true })], '')).toBe('f');
  });
  it('normalises language codes', () => {
    expect(sameLanguage('eng', 'en-US')).toBe(true);
    expect(sameLanguage('nld', 'dut')).toBe(true);
    expect(sameLanguage('de', 'nl')).toBe(false);
  });
});

describe('detectCapabilities', () => {
  it('reports codecs the element can play and treats MKV as playable on Chromium', () => {
    const fake = { canPlayType: (t: string) => (t.includes('avc1') || t.includes('mp4a') || t === 'video/mp4' ? 'probably' : '') } as HTMLVideoElement;
    const caps = detectCapabilities(fake, 'Mozilla/5.0 Chrome/140.0 Safari/537.36');
    expect(caps.videoCodecs).toEqual(['h264']);
    expect(caps.audioCodecs).toEqual(['aac']);
    expect(caps.containers).toContain('mp4');
    expect(caps.containers).toContain('mkv');
    const safari = detectCapabilities(fake, 'Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15');
    expect(safari.containers).not.toContain('mkv');
  });
});

describe('live stream helpers', () => {
  it('adds query parameters', () => {
    expect(withParam('/api/media/1/remux?audio=2', 'start', '12.000')).toBe('/api/media/1/remux?audio=2&start=12.000');
    expect(withParam('/api/subtitles/3.vtt', 'offset', 4)).toBe('/api/subtitles/3.vtt?offset=4');
  });

  it('asks the server for the preferred audio language only when needed', () => {
    const tracks = [
      { index: 1, language: 'eng', isDefault: true },
      { index: 2, language: 'nld', isDefault: false },
    ];
    expect(preferredAudioIndex(tracks, 'nl', false)).toBe(2);
    expect(preferredAudioIndex(tracks, 'en', false)).toBeUndefined();
    expect(preferredAudioIndex(tracks, 'nl', true)).toBeUndefined();
    expect(preferredAudioIndex(tracks, '', false)).toBeUndefined();
    expect(preferredAudioIndex(tracks, 'de', false)).toBeUndefined();
  });

});

describe('remembered subtitle choice', () => {
  const opts = [
    sub('nl-forced', 'nl', { forced: true }),
    sub('nl', 'dut'),
    sub('en', 'eng'),
    sub('untagged', null, { label: 'Director commentary' }),
  ];
  it('restores the same language and kind (full or forced)', () => {
    expect(pickSubtitle(opts, { language: 'nl' })).toBe('nl');
    expect(pickSubtitle(opts, { language: 'nl', forced: true })).toBe('nl-forced');
    expect(pickSubtitle(opts, { language: 'en', forced: true })).toBe('en');
  });
  it('matches untagged tracks by label', () => {
    expect(pickSubtitle(opts, { language: '', label: 'Director commentary' })).toBe('untagged');
  });
  it('stays off when nothing matches', () => {
    expect(pickSubtitle(opts, { language: 'fr' })).toBeNull();
    expect(pickSubtitle(opts, { language: '' })).toBeNull();
  });
  it('normalises language codes for storage', () => {
    expect(normalizeLanguage('dut')).toBe('nl');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('hun')).toBe('hun');
    expect(normalizeLanguage(null)).toBe('');
  });
});

describe('playHref', () => {
  it('resumes directly when a position is given', () => {
    expect(playHref('movie', 5)).toBe('/play/movie/5');
    expect(playHref('movie', 5, 0)).toBe('/play/movie/5');
    expect(playHref('episode', 12, 600.7)).toBe('/play/episode/12?t=600');
    expect(playHref('movie', 5, 30, 9)).toBe('/play/movie/5?t=30&file=9');
  });
});

describe('subtitleName', () => {
  it('tells subtitles in the same language apart by their title', async () => {
    expect(subtitleName({ language: 'eng', languageName: 'English', title: null })).toBe('English');
    expect(subtitleName({ language: 'eng', languageName: 'English', title: 'English' })).toBe('English');
    expect(subtitleName({ language: 'eng', languageName: 'English', title: 'SDH' })).toBe('English · SDH');
    expect(subtitleName({ language: 'eng', languageName: 'English', title: 'Commentary' })).toBe('English · Commentary');
    expect(subtitleName({ language: null, title: 'Signs & Songs' })).toBe('Signs & Songs');
    expect(subtitleName({ language: null, title: null })).toBe('Unknown language');
    await setLanguage('nl');
    try {
      // The language in the interface language; a title that only repeats it is left out.
      expect(subtitleName({ language: 'eng', languageName: 'English', title: 'English' })).toBe('Engels');
      expect(subtitleName({ language: 'eng', languageName: 'English', title: 'SDH' })).toBe('Engels · SDH');
    } finally {
      await setLanguage('en');
    }
  });
});
