import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { nl } from './nl.js';

/**
 * Interface languages. Adding one: add its code here, a catalog next to nl.ts, and the frontend
 * locale (frontend/src/i18n). English is the source language, so it has no catalog.
 */
export const LANGUAGES = ['en', 'nl'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

/** Only the languages Velyx has; anything else is rejected. */
export const languageSchema = z.enum(LANGUAGES, { message: 'Unsupported language.' });

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Translations of the server's own texts (errors, explanations), keyed by the English text itself.
 * `{name}` placeholders are filled from `params`.
 */
const CATALOGS: Record<Exclude<Language, 'en'>, Record<string, string>> = { nl };

export type Params = Record<string, string | number | ((lang: Language) => string)>;

export function tr(lang: Language, message: string, params?: Params): string {
  const template = lang === 'en' ? message : (CATALOGS[lang][message] ?? message);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (all, key: string) => {
    const v = params[key];
    if (v === undefined) return all;
    return typeof v === 'function' ? v(lang) : String(v);
  });
}

/** Whether a message has a translation for every language (used by tests). */
export function hasTranslation(message: string): boolean {
  return Object.values(CATALOGS).every((c) => message in c);
}

/**
 * The language to answer a request in: the signed-in user's choice; before signing in, what the
 * browser asked for (the X-Velyx-Language header the web app sends, then Accept-Language).
 */
export function requestLanguage(request: FastifyRequest): Language {
  if (request.user?.language) return request.user.language;
  const header = request.headers['x-velyx-language'];
  if (isLanguage(header)) return header;
  const accept = String(request.headers['accept-language'] ?? '');
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLanguage(code)) return code;
  }
  return DEFAULT_LANGUAGE;
}
