import { Link } from 'react-router-dom';
import { Check, Play } from 'lucide-react';
import type { Card, ContinueItem } from '../lib/types';
import { formatClock, progressFraction } from '../lib/format';
import { Artwork } from './Artwork';
import { ProgressBar } from './ProgressBar';

export function PosterCard({ item, className = '' }: { item: Card; className?: string }) {
  const href = item.type === 'movie' ? `/movies/${item.id}` : `/shows/${item.id}`;
  const watched = item.type === 'movie' ? item.progress?.completed : item.episodeCount > 0 && item.watchedCount >= item.episodeCount;
  const fraction = item.type === 'movie' ? (item.progress && !item.progress.completed ? progressFraction(item.progress) : 0) : 0;
  const unwatchedEpisodes = item.type === 'show' ? item.episodeCount - item.watchedCount : 0;
  return (
    <Link to={href} className={`group block focus-visible:outline-none ${className}`}>
      <div className="relative overflow-hidden rounded-[var(--radius-card)] ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-accent/60 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <Artwork path={item.posterPath} title={item.title} />
        {watched && (
          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-ok text-bg shadow" title="Watched">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
        {item.type === 'show' && !watched && item.watchedCount > 0 && unwatchedEpisodes > 0 && (
          <span className="absolute top-2 right-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink" title={`${unwatchedEpisodes} unwatched`}>
            {unwatchedEpisodes}
          </span>
        )}
        {fraction > 0 && <ProgressBar value={fraction} className="absolute inset-x-2 bottom-2 w-auto" />}
      </div>
      <p className="mt-2 truncate text-sm font-medium text-ink/90 group-hover:text-ink">{item.title}</p>
      <p className="text-xs text-faint">{item.year ?? (item.type === 'show' ? `${item.episodeCount} ${item.episodeCount === 1 ? 'episode' : 'episodes'}` : '\u00a0')}</p>
    </Link>
  );
}

/**
 * Continue Watching card. Clicking the card opens the movie or show page; the round play button
 * resumes playback directly.
 */
export function ContinueCard({ item }: { item: ContinueItem }) {
  const playHref = item.type === 'movie' ? `/play/movie/${item.id}` : `/play/episode/${item.id}`;
  const detailsHref = item.type === 'movie' ? `/movies/${item.id}` : `/shows/${item.showId}`;
  const fraction = progressFraction(item.progress);
  const remaining = item.progress ? item.progress.durationSec - item.progress.positionSec : 0;
  return (
    <div className="group relative w-72 shrink-0 sm:w-80">
      <Link to={detailsHref} className="block focus-visible:outline-none" aria-label={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ''}: details`}>
        <div className="relative overflow-hidden rounded-[var(--radius-card)] ring-1 ring-white/5 transition group-hover:ring-accent/60 group-has-[a:focus-visible]:ring-2 group-has-[a:focus-visible]:ring-accent">
          <Artwork path={item.imagePath ?? item.posterPath} size="w780" aspect="wide" title={item.title} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          <div className="absolute bottom-3 left-3 right-16">
            <ProgressBar value={fraction} />
          </div>
        </div>
        <p className="mt-2 truncate text-sm font-medium group-hover:text-ink">{item.title}</p>
        <p className="truncate text-xs text-faint">
          {item.subtitle}
          {remaining > 60 && ` — ${formatClock(remaining)} left`}
        </p>
      </Link>
      <Link
        to={playHref}
        aria-label={`Resume ${item.title}`}
        title="Resume"
        className="absolute right-3 bottom-[4.1rem] grid size-10 place-items-center rounded-full bg-ink/90 text-bg shadow-lg transition hover:scale-110 hover:bg-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        <Play className="ml-0.5 size-4 fill-current" />
      </Link>
    </div>
  );
}
