import type { Translate } from './i18n';
import type { ContinueItem } from './types';

/**
 * The line under a Continue Watching card: "S1 E2 · Title", "Up next · S1 E3 · Title", or a movie's
 * year. Built here from the episode's fields: the server's own subtitle already holds the title and an
 * English "Next:", so adding them to it showed both twice.
 */
export function continueLine(item: ContinueItem, t: Translate): string {
  if (item.seasonNumber === null || item.episodeNumber === null) return item.subtitle ?? '';
  return [item.upNext ? t('home.upNext') : null, `S${item.seasonNumber} E${item.episodeNumber}`, item.episodeTitle].filter(Boolean).join(' · ');
}
