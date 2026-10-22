import { episodeCode, formatRuntime } from './format';
import type { Translate } from './i18n';
import type { EpisodeSummary, Person } from './types';

/** "S01E02 · 52m" under an episode on the TV detail page. */
export function episodeFacts(e: EpisodeSummary): string {
  const runtime = formatRuntime(e.runtime ?? (e.durationSec ? Math.round(e.durationSec / 60) : null));
  return [episodeCode(e.seasonNumber, e.episodeNumber), runtime].filter(Boolean).join(' · ');
}

/** The episode a season's row starts at: the one to watch next if it is in this season, else the first. */
export function startEpisode(episodes: EpisodeSummary[], upNextId: number | null | undefined): number {
  const i = upNextId == null ? -1 : episodes.findIndex((e) => e.id === upNextId);
  return Math.max(0, i);
}

/** One line of the "About" block on a TV detail page: "Genres  Drama, Crime". */
export interface AboutFact {
  label: string;
  value: string;
}

interface AboutSource {
  title: string;
  originalTitle?: string | null;
  genres: { name: string }[];
  director?: string | null;
  network?: string | null;
  crew?: Person[];
}

/** What the "About" block lists under the story: genres, who made it, the network and the original title. */
export function aboutFacts(d: AboutSource, t: Translate): AboutFact[] {
  const creators = (d.crew ?? []).filter((p) => p.role === 'Creator').map((p) => p.name);
  const facts: (AboutFact | null)[] = [
    d.genres.length ? { label: t('detail.genres'), value: d.genres.map((g) => g.name).join(', ') } : null,
    d.director ? { label: t('detail.director'), value: d.director } : null,
    creators.length ? { label: t('detail.createdBy'), value: creators.join(', ') } : null,
    d.network ? { label: t('detail.network'), value: d.network } : null,
    d.originalTitle && d.originalTitle !== d.title ? { label: t('detail.originalTitle'), value: d.originalTitle } : null,
  ];
  return facts.filter((f): f is AboutFact => f !== null);
}

/** Initials for a cast member without a photo ("Cillian Murphy" → "CM"). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}
