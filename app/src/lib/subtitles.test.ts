import { describe, expect, it } from 'vitest';
import type { SubtitleOption } from './playback';
import { choiceFor, initialSubtitle, pickRemembered, sameLanguage } from './subtitles';

const o = (key: string, language: string | null, forced = false, isDefault = false, label = key): SubtitleOption => ({ key, kind: 'external', label, language, languageName: null, title: null, forced, isDefault, url: `/${key}` });
const options = [o('en', 'eng'), o('nl-forced', 'nl', true), o('nl', 'nld')];

describe('starting subtitle', () => {
  it('remembers the last choice on this device (the default mode)', () => {
    expect(initialSubtitle(options, { subtitleMode: 'remember' }, { language: 'nl' }, 'eng')?.key).toBe('nl');
    expect(initialSubtitle(options, null, { language: 'nl', forced: true }, 'eng')?.key).toBe('nl-forced');
    // Off stays off, unless the file itself marks a forced track as default.
    expect(initialSubtitle(options, { subtitleMode: 'remember' }, { language: '' }, 'eng')).toBeNull();
    expect(initialSubtitle([...options, o('fx', 'en', true, true)], { subtitleMode: 'remember' }, { language: '' }, 'eng')?.key).toBe('fx');
    // Nothing chosen yet on this device.
    expect(initialSubtitle(options, { subtitleMode: 'remember' }, null, 'eng')).toBeNull();
  });

  it('follows the account for the other modes', () => {
    expect(initialSubtitle(options, { subtitleMode: 'always', subtitleLanguage: 'nl' }, null, 'eng')?.key).toBe('nl');
    expect(initialSubtitle(options, { subtitleMode: 'always', subtitleLanguage: 'fr', subtitleFallback: 'en' }, null, 'eng')?.key).toBe('en');
    expect(initialSubtitle(options, { subtitleMode: 'foreign', subtitleLanguage: 'nl' }, null, 'eng')?.key).toBe('nl');
    expect(initialSubtitle(options, { subtitleMode: 'foreign', subtitleLanguage: 'nl' }, null, 'nld')?.key).toBe('nl-forced');
    expect(initialSubtitle(options, { subtitleMode: 'forced', subtitleLanguage: 'nl' }, null, 'nld')?.key).toBe('nl-forced');
    expect(initialSubtitle(options, { subtitleMode: 'off' }, { language: 'nl' }, 'eng')).toBeNull();
  });

  it('remembers a choice so the same kind of track is found in the next episode', () => {
    expect(choiceFor(options[2]!)).toEqual({ language: 'nld', forced: false });
    expect(choiceFor(null)).toEqual({ language: '' });
    const untagged = o('x', null, false, false, 'Director commentary');
    expect(choiceFor(untagged)).toEqual({ language: '', forced: false, label: 'Director commentary' });
    expect(pickRemembered([untagged], choiceFor(untagged))?.key).toBe('x');
    expect(sameLanguage('eng', 'en-US')).toBe(true);
    expect(sameLanguage('nld', 'dut')).toBe(true);
  });
});
