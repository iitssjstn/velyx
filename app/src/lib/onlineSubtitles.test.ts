import { describe, expect, it } from 'vitest';
import { defaultOnlineLanguage, languageName, onlineLanguage } from './onlineSubtitles';

describe('online subtitle languages', () => {
  it('maps language codes to what OpenSubtitles knows', () => {
    expect(onlineLanguage('nld')).toBe('nl');
    expect(onlineLanguage('pt-BR')).toBe('pt-br');
    expect(onlineLanguage('pt')).toBe('pt-pt');
    expect(onlineLanguage('xx')).toBeNull();
    expect(defaultOnlineLanguage(null, 'klingon', 'dut')).toBe('nl');
    expect(defaultOnlineLanguage(null)).toBe('en');
  });

  it('names a language, or shows its code', () => {
    expect(languageName('nl', 'nl')).toBe('Nederlands');
    expect(languageName('zz', 'en')).toBe('ZZ');
  });
});
