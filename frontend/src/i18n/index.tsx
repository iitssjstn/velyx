import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { en } from './en/index';

/**
 * Interface translations. Components use stable keys (`t('nav.home')`); every language has the
 * same keys as English (the compiler checks this), and English is the fallback. Only English is in
 * the main bundle: another language is downloaded once, when someone chooses it.
 *
 * Adding a language: add it to LANGUAGES and LOADERS, create a folder next to `nl/` with the same
 * files, and add the code on the server (backend/src/i18n).
 */

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'nl', name: 'Nederlands' },
] as const;
export type Language = (typeof LANGUAGES)[number]['code'];

/** A text that depends on a number: `{ one: '1 episode', other: '{count} episodes' }`. */
export interface Plural {
  one: string;
  other: string;
}
type Tree = { [key: string]: string | Plural | Tree };

/** Every language has exactly the shape of the English messages. */
export type Messages<T = typeof en> = { [K in keyof T]: T[K] extends string ? string : T[K] extends Plural ? Plural : Messages<T[K]> };

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<typeof en>;
export type Params = Record<string, string | number>;

const LOADERS: Record<Exclude<Language, 'en'>, () => Promise<Messages>> = {
  nl: () => import('./nl/index').then((m) => m.nl),
};

const STORAGE_KEY = 'velyx.language';
const INTL_LOCALE: Record<Language, string> = { en: 'en-GB', nl: 'nl-NL' };

function flatten(tree: Tree, prefix = '', out = new Map<string, string | Plural>()): Map<string, string | Plural> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix + k;
    if (typeof v === 'string' || ('one' in v && 'other' in v && typeof v.one === 'string')) out.set(key, v as string | Plural);
    else flatten(v as Tree, `${key}.`, out);
  }
  return out;
}

const english = flatten(en as unknown as Tree);
let current: Language = 'en';
let table = english;
let plurals = new Intl.PluralRules(INTL_LOCALE.en);
const loaded = new Map<Language, Map<string, string | Plural>>([['en', english]]);
const listeners = new Set<() => void>();

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}

export function currentLanguage(): Language {
  return current;
}

/** The locale for dates and numbers ("nl-NL"). */
export function intlLocale(): string {
  return INTL_LOCALE[current];
}

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (params[name] === undefined ? all : String(params[name])));
}

/** The text for `key` in the current language, with `{placeholders}` filled in. */
export function t(key: MessageKey, params?: Params): string {
  const value = table.get(key) ?? english.get(key);
  if (value === undefined) return key;
  if (typeof value === 'string') return interpolate(value, params);
  const count = Number(params?.count ?? 0);
  return interpolate(plurals.select(count) === 'one' ? value.one : value.other, { ...params, count: count.toLocaleString(INTL_LOCALE[current]) });
}

/**
 * Like `t`, for texts with links or emphasis inside: `{name}` placeholders may be React nodes.
 * `tRich('login.help', { link: <a …>docs</a> })`.
 */
export function tRich(key: MessageKey, parts: Record<string, ReactNode>): ReactNode {
  const text = t(key);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    out.push(text.slice(last, m.index));
    out.push(<Fragment key={m.index}>{parts[m[1]] ?? m[0]}</Fragment>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** Loads a language (once) and switches the whole interface to it, without reloading the page. */
export async function setLanguage(lang: Language): Promise<void> {
  if (!loaded.has(lang)) loaded.set(lang, flatten((await LOADERS[lang as Exclude<Language, 'en'>]()) as unknown as Tree));
  current = lang;
  table = loaded.get(lang)!;
  plurals = new Intl.PluralRules(INTL_LOCALE[lang]);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode: remembered for this visit only */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

/**
 * The language before anyone signs in: the last one used on this device, else the browser's
 * language when Velyx has it, else English. A signed-in user's own choice replaces it.
 */
export function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    /* ignore */
  }
  const browser = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const l of browser) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (isLanguage(code)) return code;
  }
  return 'en';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Re-renders the component when the language changes. Any component that shows text calls this,
 * so switching language updates what is on screen without remounting anything (a playing video
 * keeps playing).
 */
export function useT(): { t: typeof t; tRich: typeof tRich; lang: Language } {
  const lang = useSyncExternalStore(subscribe, currentLanguage, currentLanguage);
  return { t, tRich, lang };
}

const displayNames = new Map<string, Intl.DisplayNames>();
/**
 * A language's name in the interface language ("eng" → "English" / "Engels"), for audio and
 * subtitle tracks. Null when the code is missing or not a real language.
 */
export function languageLabel(code: string | null | undefined): string | null {
  if (!code || code === 'und' || code === 'zxx' || code === 'mul') return null;
  const locale = intlLocale();
  if (!displayNames.has(locale)) displayNames.set(locale, new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }));
  try {
    const name = displayNames.get(locale)!.of(code);
    return name ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : null;
  } catch {
    return null;
  }
}
