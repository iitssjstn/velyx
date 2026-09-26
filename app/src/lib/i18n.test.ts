import { describe, expect, it } from 'vitest';
import { MESSAGES, pickLanguage, translator } from './i18n';
import { episodeCode, formatClock, formatRuntime, imagePath, progressFraction } from './format';

describe('texts', () => {
  it('has every text in Dutch too, with the same placeholders', () => {
    for (const [key, en] of Object.entries(MESSAGES.en)) {
      const nl = MESSAGES.nl[key as keyof typeof MESSAGES.en];
      expect(nl, key).toBeTruthy();
      expect([...nl.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual([...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });

  it('follows the phone: Dutch for nl, otherwise English', () => {
    expect(pickLanguage(['nl-NL'])).toBe('nl');
    expect(pickLanguage(['nl-BE', 'en-US'])).toBe('nl');
    expect(pickLanguage(['de-DE', 'en-GB'])).toBe('en');
    expect(pickLanguage(['fr-FR'])).toBe('en');
    expect(translator('nl')('show.watched', { watched: 3, total: 10 })).toBe('3 van 10 gezien');
  });
});

describe('formatting', () => {
  it('formats artwork paths, times and episode codes', () => {
    expect(imagePath('/abc.jpg', 'w780')).toBe('/api/images/w780/abc.jpg');
    expect(imagePath(null)).toBeNull();
    expect(formatRuntime(155)).toBe('2h 35m');
    expect(formatRuntime(47)).toBe('47m');
    expect(formatRuntime(120)).toBe('2h');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(65)).toBe('1:05');
    expect(episodeCode(2, 4)).toBe('S02E04');
    expect(progressFraction({ positionSec: 30, durationSec: 60 })).toBe(0.5);
    expect(progressFraction(null)).toBe(0);
  });
});
