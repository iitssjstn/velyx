/**
 * Metadata in the interface languages (English and Dutch): titles, descriptions and taglines as
 * TMDB has them, kept next to what was stored before. Nothing stored earlier is replaced: an item
 * without a translation keeps showing what it had.
 */

export type UiLanguage = 'en' | 'nl';
export const UI_LANGUAGES: UiLanguage[] = ['en', 'nl'];

export interface Translation {
  title?: string;
  overview?: string;
  tagline?: string;
}

export type Translations = Partial<Record<UiLanguage, Translation>>;

/** TMDB's `translations` answer (movies: title; shows and seasons: name). */
export interface TmdbTranslations {
  translations?: Array<{ iso_639_1?: string; iso_3166_1?: string; data?: { title?: string; name?: string; overview?: string; tagline?: string } }>;
}

/** The region preferred for each language when TMDB has several (Dutch from the Netherlands, American English). */
const REGION: Record<UiLanguage, string> = { en: 'US', nl: 'NL' };

const clean = (s: string | undefined | null) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 5000) : undefined);

/** Picks the interface languages out of TMDB's translations (empty ones left out). */
export function fromTmdb(t: TmdbTranslations | undefined | null): Translations {
  const out: Translations = {};
  for (const lang of UI_LANGUAGES) {
    const all = (t?.translations ?? []).filter((x) => x.iso_639_1 === lang);
    const best = all.find((x) => x.iso_3166_1 === REGION[lang]) ?? all[0];
    if (!best?.data) continue;
    const entry: Translation = { title: clean(best.data.title ?? best.data.name), overview: clean(best.data.overview), tagline: clean(best.data.tagline) };
    for (const k of Object.keys(entry) as Array<keyof Translation>) if (entry[k] === undefined) delete entry[k];
    if (Object.keys(entry).length) out[lang] = entry;
  }
  return out;
}

/** Joins what is known: newer values win, nothing known is dropped. */
export function mergeTranslations(before: Translations | null | undefined, after: Translations): Translations {
  const out: Translations = { ...(before ?? {}) };
  for (const lang of UI_LANGUAGES) if (after[lang]) out[lang] = { ...(out[lang] ?? {}), ...after[lang] };
  return out;
}

export function parseTranslations(raw: string | null | undefined): Translations {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Translations) : {};
  } catch {
    return {};
  }
}

/** The interface language of a TMDB language setting ("nl-NL" → nl), or null for any other language. */
export function uiLanguageOf(tmdbLanguage: string): UiLanguage | null {
  const code = tmdbLanguage.slice(0, 2).toLowerCase();
  return code === 'nl' || code === 'en' ? code : null;
}

/**
 * Title, description and tagline in the viewer's language when known; otherwise what is stored.
 * Only the language the metadata was not fetched in needs a translation.
 */
export function localized<T extends { title?: string | null; overview: string | null; tagline?: string | null; translations?: string | null }>(row: T, lang: string | null | undefined): { title: NonNullable<T['title']> | string | null; overview: string | null; tagline: string | null } {
  const t = lang === 'nl' || lang === 'en' ? parseTranslations(row.translations)[lang] : undefined;
  return { title: t?.title ?? row.title ?? null, overview: t?.overview ?? row.overview, tagline: t?.tagline ?? row.tagline ?? null };
}
