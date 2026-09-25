import { describe, expect, it } from 'vitest';
import { pickSubtitle, preferredAudioIndex, seekPlan, startPosition, withParam } from './player';
import { detectCapabilities } from './codecs';
import { sameLanguage } from './prefs';
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
  it('resumes unfinished items only', () => {
    expect(startPosition(null, { positionSec: 600, durationSec: 6000, completed: false })).toBe(600);
    expect(startPosition(null, { positionSec: 600, durationSec: 6000, completed: true })).toBe(0);
    expect(startPosition(null, { positionSec: 10, durationSec: 6000, completed: false })).toBe(0);
    expect(startPosition(null, { positionSec: 5990, durationSec: 6000, completed: false })).toBe(0);
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

  it('seeks locally inside the buffer and restarts the stream elsewhere', () => {
    // bufferedEnd is in stream time (the stream starts at offset 120)
    expect(seekPlan(130, 120, 30)).toEqual({ local: 10 });
    expect(seekPlan(110, 120, 30)).toEqual({ restart: true });
    expect(seekPlan(200, 120, 30)).toEqual({ restart: true });
  });
});
