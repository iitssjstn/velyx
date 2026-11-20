import type { SubtitleOption } from './playback';
import { normalizeLanguage } from './subtitles';

/** Languages OpenSubtitles can be searched in (the server accepts exactly these). */
export const ONLINE_SUBTITLE_LANGUAGES = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'is', 'it', 'ja', 'ko', 'lt', 'lv', 'ms',
  'nl', 'no', 'pl', 'pt-br', 'pt-pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-cn', 'zh-tw',
] as const;

const REGIONAL: Record<string, string> = { pt: 'pt-pt', zh: 'zh-cn', nb: 'no', nn: 'no' };

/** The OpenSubtitles code for a language code ("nld" → "nl", "pt-BR" → "pt-br"), or null. */
export function onlineLanguage(code: string | null | undefined): string | null {
  if (!code) return null;
  const lower = code.toLowerCase().replace('_', '-');
  if ((ONLINE_SUBTITLE_LANGUAGES as readonly string[]).includes(lower)) return lower;
  const base = normalizeLanguage(lower);
  const mapped = REGIONAL[base] ?? base;
  return (ONLINE_SUBTITLE_LANGUAGES as readonly string[]).includes(mapped) ? mapped : null;
}

/** The language to search in first: the first of the candidates OpenSubtitles has, else English. */
export function defaultOnlineLanguage(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const code = onlineLanguage(c);
    if (code) return code;
  }
  return 'en';
}

/** "nl" → "Nederlands" (in the app's language), or the code itself where the device has no names. */
export function languageName(code: string, appLanguage: string): string {
  try {
    const name = new Intl.DisplayNames([appLanguage], { type: 'language' }).of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    /* no language names on this device */
  }
  return code.toUpperCase();
}

/** One subtitle OpenSubtitles has for the file (as the server lists it). */
export interface OnlineSubtitleResult {
  fileId: number;
  language: string;
  release: string;
  hearingImpaired: boolean;
  forced: boolean;
  downloads: number;
  hashMatch: boolean;
  machineTranslated: boolean;
  /** Fetched before: it is among the file's subtitles already. */
  fetched: SubtitleOption | null;
}

/**
 * The order the TV goes through languages with OK on its language line: the viewer's own ones first
 * (subtitle language, fallback, the app's), then English, then the rest by name.
 */
export function languageCycle(first: string[], appLanguage: string): string[] {
  const own = [...first, 'en'].map((c) => onlineLanguage(c)).filter((c): c is string => !!c);
  const rest = ONLINE_SUBTITLE_LANGUAGES.filter((c) => !own.includes(c)).sort((a, b) => languageName(a, appLanguage).localeCompare(languageName(b, appLanguage)));
  return [...new Set([...own, ...rest])];
}

/** The language after `current` in `cycle` (after the last: the first again). */
export function nextLanguage(cycle: string[], current: string): string {
  const at = cycle.indexOf(current);
  return cycle[(at + 1) % cycle.length] ?? current;
}

/** What one line of the TV's "Online" tab does: change the language, fetch a result, or nothing (a status line). */
export type OnlineLine = { kind: 'language' } | { kind: 'result'; result: OnlineSubtitleResult } | { kind: 'status' };

/** The lines of the TV's "Online" tab: the language, then the results (or one line saying how the search goes). */
export function onlineLines(results: OnlineSubtitleResult[] | undefined, state: 'loading' | 'error' | 'ready'): OnlineLine[] {
  const language: OnlineLine = { kind: 'language' };
  if (state !== 'ready' || !results?.length) return [language, { kind: 'status' }];
  return [language, ...results.slice(0, 12).map((result) => ({ kind: 'result' as const, result }))];
}
