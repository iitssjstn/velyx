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

/**
 * Picks the subtitle to enable at start:
 * 1. a subtitle in the preferred language (full, non-forced first),
 * 2. otherwise a forced track (foreign-language parts) if the file flags one as default,
 * 3. otherwise none.
 */
export function pickSubtitle(options: SubtitleOption[], preferredLanguage: string): string | null {
  if (preferredLanguage) {
    const lang = options.filter((o) => sameLanguage(o.language, preferredLanguage));
    const full = lang.find((o) => !o.forced) ?? lang[0];
    if (full) return full.key;
  }
  const forced = options.find((o) => o.forced && o.isDefault);
  return forced?.key ?? null;
}

/** True when the given element is focused in a way where keyboard shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return Boolean(t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)));
}
