import type { SubtitleOption } from './types';
import { sameLanguage } from './prefs';

/** Where playback should start: explicit ?t= wins, then saved progress (unless finished or at the very end). */
export function startPosition(tParam: string | null, progress: { positionSec: number; durationSec: number; completed: boolean } | null | undefined): number {
  if (tParam !== null) {
    const t = Number(tParam);
    return Number.isFinite(t) && t > 0 ? t : 0;
  }
  if (!progress || progress.completed) return 0;
  if (progress.positionSec < 30) return 0;
  if (progress.durationSec > 0 && progress.durationSec - progress.positionSec < 15) return 0;
  return progress.positionSec;
}

export interface SubtitleChoice {
  language: string;
  forced?: boolean;
  label?: string;
}

/**
 * Picks the subtitle to enable at start, based on what the viewer chose last time:
 * 1. a subtitle in that language (full or forced, whichever was chosen; the other as fallback),
 * 2. for untagged tracks: one with the same label,
 * 3. otherwise a forced track (foreign-language parts) if the file flags one as default,
 * 4. otherwise none.
 */
export function pickSubtitle(options: SubtitleOption[], choice: SubtitleChoice | string): string | null {
  const c = typeof choice === 'string' ? { language: choice } : choice;
  if (c.language) {
    const lang = options.filter((o) => sameLanguage(o.language, c.language));
    const match = lang.find((o) => o.forced === Boolean(c.forced)) ?? lang[0];
    if (match) return match.key;
  } else if (c.label) {
    const byLabel = options.find((o) => o.label === c.label);
    if (byLabel) return byLabel.key;
  }
  const forced = options.find((o) => o.forced && o.isDefault);
  return forced?.key ?? null;
}

/** True when the given element is focused in a way where keyboard shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return Boolean(t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)));
}

/** Appends a query parameter to a URL that may already have a query string. */
export function withParam(url: string, key: string, value: string | number): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(String(value))}`;
}

/**
 * The audio track to request up front: the preferred language when the browser cannot switch
 * tracks itself and that language is not already the default. undefined = file default.
 */
export function preferredAudioIndex(
  tracks: { index: number; language: string | null; isDefault: boolean }[],
  preferredLanguage: string,
  nativeSwitching: boolean,
): number | undefined {
  if (!preferredLanguage || nativeSwitching || tracks.length < 2) return undefined;
  const def = tracks.find((t) => t.isDefault) ?? tracks[0];
  if (def && sameLanguage(def.language, preferredLanguage)) return undefined;
  return tracks.find((t) => sameLanguage(t.language, preferredLanguage))?.index;
}

/**
 * Where a seek should go for live (restart) streams: within what is already buffered the browser
 * can seek locally; anything else needs a new stream from the server.
 */
/** `bufferedEnd` is measured in stream time (seconds since `offset`). */
export function seekPlan(target: number, offset: number, bufferedEnd: number): { local: number } | { restart: true } {
  const local = target - offset;
  if (local >= 0 && local <= bufferedEnd - 0.3) return { local };
  return { restart: true };
}
