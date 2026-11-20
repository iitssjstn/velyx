import { describe, expect, it } from 'vitest';
import { ONLINE_SUBTITLE_LANGUAGES, defaultOnlineLanguage, languageCycle, languageName, nextLanguage, onlineLanguage, onlineLines } from './onlineSubtitles';

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

describe('searching online on the TV', () => {
  const result = (fileId: number) => ({ fileId, language: 'nl', release: `Release.${fileId}`, hearingImpaired: false, forced: false, downloads: 1, hashMatch: false, machineTranslated: false, fetched: null });
  it('goes through the viewer\'s own languages first, then English, then the rest', () => {
    const cycle = languageCycle(['nld', null as unknown as string, 'nl'], 'nl');
    expect(cycle.slice(0, 2)).toEqual(['nl', 'en']);
    expect(new Set(cycle).size).toBe(ONLINE_SUBTITLE_LANGUAGES.length);
    expect(nextLanguage(cycle, 'nl')).toBe('en');
    expect(nextLanguage(cycle, cycle[cycle.length - 1]!)).toBe('nl');
  });
  it('lists the language, then the results or how the search goes', () => {
    expect(onlineLines(undefined, 'loading')).toEqual([{ kind: 'language' }, { kind: 'status' }]);
    expect(onlineLines([], 'ready')).toEqual([{ kind: 'language' }, { kind: 'status' }]);
    expect(onlineLines([result(1), result(2)], 'ready').map((l) => l.kind)).toEqual(['language', 'result', 'result']);
    expect(onlineLines(Array.from({ length: 20 }, (_, i) => result(i)), 'ready')).toHaveLength(13);
  });
});
