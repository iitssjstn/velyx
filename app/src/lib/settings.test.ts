import { describe, expect, it, vi } from 'vitest';

vi.mock('./onlineSubtitles', () => ({ languageName: (code: string) => `name-${code}` }));

const { DEFAULT_DEVICE_PREFS, MEDIA_LANGUAGES, languageChoices, nextCountdown, readDevicePrefs, skipModes, subtitleFields } = await import('./settings');

describe('Account → Playback settings', () => {
  it('offers the empty choice first, then the languages, keeping one the account has outside the list', () => {
    const choices = languageChoices('nl', 'Original', 'en');
    expect(choices[0]).toEqual({ value: '', label: 'Original' });
    expect(choices.map((c) => c.value).slice(1)).toEqual([...MEDIA_LANGUAGES]);
    expect(languageChoices('ru', 'None', 'en').at(-1)).toEqual({ value: 'ru', label: 'name-ru' });
    expect(languageChoices(null, 'None', 'en')).toHaveLength(MEDIA_LANGUAGES.length + 1);
  });

  it('only lets the subtitle languages be changed where they do something (as on the website)', () => {
    expect(subtitleFields('remember')).toEqual({ language: false, fallback: false, needsLanguage: false });
    expect(subtitleFields('off')).toEqual({ language: false, fallback: false, needsLanguage: false });
    expect(subtitleFields('forced')).toEqual({ language: true, fallback: false, needsLanguage: false });
    expect(subtitleFields('always')).toEqual({ language: true, fallback: true, needsLanguage: true });
    expect(subtitleFields('foreign')).toEqual({ language: true, fallback: true, needsLanguage: true });
  });

  it('lets the recap setting follow the intro setting until it is set itself', () => {
    expect(skipModes(null)).toEqual({ recap: 'ask', intro: 'ask', credits: 'ask' });
    expect(skipModes({ skipIntro: 'always' })).toEqual({ recap: 'always', intro: 'always', credits: 'ask' });
    expect(skipModes({ skipIntro: 'always', skipRecap: 'never', skipCredits: 'always' })).toEqual({ recap: 'never', intro: 'always', credits: 'always' });
  });

  it('reads what this device stored, falling back to the defaults for anything unknown', () => {
    expect(readDevicePrefs(null)).toEqual(DEFAULT_DEVICE_PREFS);
    expect(readDevicePrefs({ autoplayNext: false, countdown: 20, surround: true })).toEqual({ autoplayNext: false, countdown: 20, surround: true });
    expect(readDevicePrefs({ autoplayNext: 'no', countdown: 7, surround: 'yes' })).toEqual(DEFAULT_DEVICE_PREFS);
  });

  it('counts down to the next episode only with autoplay on', () => {
    expect(nextCountdown({ autoplayNext: true, countdown: 15 })).toBe(15);
    expect(nextCountdown({ autoplayNext: false, countdown: 15 })).toBeNull();
  });
});
