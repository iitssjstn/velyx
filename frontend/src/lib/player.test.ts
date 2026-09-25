import { describe, expect, it } from 'vitest';
import { pickSubtitle, startPosition } from './player';
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
