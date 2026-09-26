import { Link } from 'react-router-dom';
import { Check, Play, Star, X } from 'lucide-react';
import type { Card, ContinueItem } from '../lib/types';
import { formatClock, formatRuntime, progressFraction } from '../lib/format';
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
          <span className="absolute top-2 right-2 z-10 grid size-6 place-items-center rounded-full bg-ok text-bg shadow" title="Watched">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
        {item.type === 'show' && !watched && item.watchedCount > 0 && unwatchedEpisodes > 0 && (
          <span className="absolute top-2 right-2 z-10 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink" title={`${unwatchedEpisodes} unwatched`}>
            {unwatchedEpisodes}
          </span>
        )}
        <CardDetails item={item} withProgress={fraction > 0} />
        {fraction > 0 && <ProgressBar value={fraction} className="absolute inset-x-2 bottom-2 z-10 w-auto" />}
      </div>
      <p className="mt-2 truncate text-sm font-medium text-ink/90 group-hover:text-ink">{item.title}</p>
      <p className="text-xs text-faint">{item.year ?? (item.type === 'show' ? `${item.episodeCount} ${item.episodeCount === 1 ? 'episode' : 'episodes'}` : '\u00a0')}</p>
    </Link>
  );
}

/** "2008 • 2h 32m" for movies, "2008 • 5 Seasons" for series. */
export function cardFacts(item: Card): string {
  const second =
    item.type === 'movie' ? formatRuntime(item.runtime) : item.seasonCount > 0 ? `${item.seasonCount} ${item.seasonCount === 1 ? 'Season' : 'Seasons'}` : null;
  return [item.year, second].filter(Boolean).join(' • ');
}

/**
 * Details revealed over the poster on hover or keyboard focus. Uses only what the grid already
 * loaded (no request per hover), sits on top of the poster without changing the layout, and is
 * never shown on touch screens, where hover does not exist (Tailwind's hover variant only applies
 * to devices that can hover).
 */
function CardDetails({ item, withProgress }: { item: Card; withProgress: boolean }) {
  const facts = cardFacts(item);
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pt-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none ${withProgress ? 'pb-5' : 'pb-3'}`}
    >
      <div className="translate-y-1 transition-transform duration-200 group-hover:translate-y-0 group-focus-visible:translate-y-0 motion-reduce:transition-none">
        <p className="line-clamp-2 font-display text-sm leading-tight font-semibold text-ink">{item.title}</p>
        {facts && <p className="mt-1 text-xs text-ink/80">{facts}</p>}
        {item.rating ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink/80">
            <Star className="size-3 fill-amber text-amber" />
            {item.rating.toFixed(1)}
          </p>
        ) : null}
        {item.genres.length > 0 && <p className="mt-0.5 truncate text-xs text-ink/65">{item.genres.join(' • ')}</p>}
      </div>
    </div>
  );
}

/**
 * Continue Watching card. Clicking the card opens the movie or show page; the round play button
 * resumes playback directly.
 */
export function ContinueCard({ item, onDismiss }: { item: ContinueItem; onDismiss?: (item: ContinueItem) => void }) {
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
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(item)}
          aria-label={`Remove ${item.title} from Continue Watching`}
          title="Remove from Continue Watching"
          className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/60 text-ink/80 opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-black/80 hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
