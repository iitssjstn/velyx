import { normalizeLanguage } from './prefs';

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
