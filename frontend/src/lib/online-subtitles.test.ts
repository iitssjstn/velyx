import { describe, expect, it } from 'vitest';
import { defaultOnlineLanguage, onlineLanguage } from './online-subtitles';

describe('online subtitle languages', () => {
  it('maps language codes to the ones OpenSubtitles uses', () => {
    expect(onlineLanguage('nld')).toBe('nl');
    expect(onlineLanguage('dut')).toBe('nl');
    expect(onlineLanguage('en-US')).toBe('en');
    expect(onlineLanguage('pt-BR')).toBe('pt-br');
    expect(onlineLanguage('por')).toBe('pt-pt');
    expect(onlineLanguage('zho')).toBe('zh-cn');
    expect(onlineLanguage('nb')).toBe('no');
    expect(onlineLanguage('xx')).toBeNull();
    expect(onlineLanguage('')).toBeNull();
  });

  it('searches first in the preferred subtitle language, then the fallback, then the interface language', () => {
    expect(defaultOnlineLanguage('dut', 'en', 'nl')).toBe('nl');
    expect(defaultOnlineLanguage('', 'ger', 'nl')).toBe('de');
    expect(defaultOnlineLanguage(null, undefined, 'nl')).toBe('nl');
    expect(defaultOnlineLanguage('tlh')).toBe('en');
  });
});
