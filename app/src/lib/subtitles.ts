import type { SubtitleOption } from './playback';

/**
 * Which subtitle starts when playback starts — the same rules as the website's player
 * (frontend/src/lib/player.ts initialSubtitle / pickSubtitle), so both behave alike.
 */

export type SubtitleMode = 'remember' | 'always' | 'foreign' | 'forced' | 'off';

export interface SubtitlePrefs {
  subtitleMode?: SubtitleMode | string;
  subtitleLanguage?: string | null;
  subtitleFallback?: string | null;
}

/** The viewer's last choice on this device (for the "remember" mode). Off is `{ language: '' }`. */
export interface SubtitleChoice {
  language: string;
  forced?: boolean;
  label?: string;
}

const ISO_639_2: Record<string, string> = { eng: 'en', dut: 'nl', nld: 'nl', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', swe: 'sv', nor: 'no', nob: 'no', dan: 'da', fin: 'fi', pol: 'pl', rus: 'ru', tur: 'tr', ara: 'ar' };

/** "eng", "en-US" and "EN" all become "en"; unknown codes are kept (lower-cased). */
export function normalizeLanguage(code: string | null | undefined): string {
  if (!code) return '';
  const base = code.toLowerCase().split(/[-_]/)[0] ?? '';
  return ISO_639_2[base] ?? base;
}

export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeLanguage(a) === normalizeLanguage(b);
}

/** What to remember when the viewer picks a subtitle (or Off) in the player. */
export function choiceFor(option: SubtitleOption | null): SubtitleChoice {
  if (!option) return { language: '' };
  return { language: option.language ?? '', forced: option.forced, ...(option.language ? {} : { label: option.label }) };
}

/**
 * The subtitle matching the last choice: that language (full or forced, whichever was chosen), a
 * track with the same label for untagged ones, else a forced track the file marks as default.
 */
export function pickRemembered(options: SubtitleOption[], choice: SubtitleChoice | null): SubtitleOption | null {
  const c = choice ?? { language: '' };
  if (c.language) {
    const lang = options.filter((o) => sameLanguage(o.language, c.language));
    const match = lang.find((o) => o.forced === Boolean(c.forced)) ?? lang[0];
    if (match) return match;
  } else if (c.label) {
    const byLabel = options.find((o) => o.label === c.label);
    if (byLabel) return byLabel;
  }
  return options.find((o) => o.forced && o.isDefault) ?? null;
}

/**
 * The subtitle to start with, from the account's preferences:
 * - remember (the default): the viewer's last choice on this device;
 * - always: a full subtitle in the preferred language, else the fallback language;
 * - foreign: like always, but when the audio already is in the preferred language only a forced track;
 * - forced: only forced tracks;
 * - off: none.
 */
export function initialSubtitle(options: SubtitleOption[], prefs: SubtitlePrefs | null, remembered: SubtitleChoice | null, audioLanguage: string | null): SubtitleOption | null {
  const want = prefs?.subtitleLanguage ?? '';
  const fallback = prefs?.subtitleFallback ?? '';
  const lang = (code: string, forced: boolean) => (code ? options.find((o) => sameLanguage(o.language, code) && o.forced === forced) : undefined);
  const full = (code: string) => lang(code, false) ?? (code ? options.find((o) => sameLanguage(o.language, code)) : undefined);
  switch (prefs?.subtitleMode) {
    case 'off':
      return null;
    case 'forced':
      return lang(want, true) ?? lang(audioLanguage ?? '', true) ?? options.find((o) => o.forced && o.isDefault) ?? null;
    case 'foreign':
      if (want && sameLanguage(audioLanguage, want)) return lang(want, true) ?? null;
      return full(want) ?? full(fallback) ?? null;
    case 'always':
      return full(want) ?? full(fallback) ?? null;
    default:
      return pickRemembered(options, remembered);
  }
}
