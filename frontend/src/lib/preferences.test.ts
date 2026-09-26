import { describe, expect, it } from 'vitest';
import { initialSubtitle, type LanguagePreferences } from './player';
import type { SubtitleOption } from './types';

const opt = (key: string, language: string | null, forced = false, isDefault = false): SubtitleOption =>
  ({ key, kind: 'embedded', label: key, language, forced, isDefault, url: `/s/${key}` }) as SubtitleOption;

const OPTIONS = [opt('en', 'eng'), opt('nl', 'dut'), opt('nl-forced', 'nld', true), opt('fr', 'fre')];
const prefs = (p: Partial<LanguagePreferences>): LanguagePreferences => ({ audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember', ...p });
const none = { language: '' };

describe('initialSubtitle', () => {
  it('always: preferred language, then the fallback', () => {
    expect(initialSubtitle(OPTIONS, prefs({ subtitleMode: 'always', subtitleLanguage: 'nl' }), none, 'eng')).toBe('nl');
    expect(initialSubtitle(OPTIONS, prefs({ subtitleMode: 'always', subtitleLanguage: 'de', subtitleFallback: 'en' }), none, 'eng')).toBe('en');
    expect(initialSubtitle(OPTIONS, prefs({ subtitleMode: 'always', subtitleLanguage: 'de' }), none, 'eng')).toBeNull();
  });

  it('foreign: no full subtitles when the audio is already in your language', () => {
    expect(initialSubtitle(OPTIONS, prefs({ subtitleMode: 'foreign', subtitleLanguage: 'nl' }), none, 'eng')).toBe('nl');
    expect(initialSubtitle(OPTIONS, prefs({ subtitleMode: 'foreign', subtitleLanguage: 'nl' }), none, 'nld')).toBe('nl-forced');
    expect(initialSubtitle([opt('nl', 'nl')], prefs({ subtitleMode: 'foreign', subtitleLanguage: 'nl' }), none, 'nl')).toBeNull();
  });

  it('forced, off and remember', () => {
    expect(initialSubtitle(OPTIONS, prefs({ subtitleMode: 'forced', subtitleLanguage: 'nl' }), none, 'eng')).toBe('nl-forced');
    expect(initialSubtitle(OPTIONS, prefs({ subtitleMode: 'off', subtitleLanguage: 'nl' }), { language: 'en' }, 'eng')).toBeNull();
    // remember = the viewer's last choice in this browser (previous behaviour).
    expect(initialSubtitle(OPTIONS, prefs({}), { language: 'fr' }, 'eng')).toBe('fr');
  });
});
