import { playHref, resumePoint } from '../lib/player';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, MoreHorizontal, Play, RotateCcw, Star, X } from 'lucide-react';
import { continueDetail, continuePosition, isStarted, resumeHref, startOverHref } from '../lib/continue';
import type { Card, ContinueItem, ShowDetail } from '../lib/types';
import { formatRuntime, progressFraction } from '../lib/format';
import { api } from '../lib/api';
import { Artwork } from './Artwork';
import { ProgressBar } from './ProgressBar';
import { t, useT } from '../i18n';
import { useKeepOnScreen } from '../lib/hooks';
import { seriesContinue } from '../lib/series';
import { toast } from './Toast';

export function PosterCard({ item, className = '', gridActions = false }: { item: Card; className?: string; gridActions?: boolean }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [openingShow, setOpeningShow] = useState(false);
  const href = item.type === 'movie' ? `/movies/${item.id}` : `/shows/${item.id}`;
  const watched = item.type === 'movie' ? item.progress?.completed : item.episodeCount > 0 && item.watchedCount >= item.episodeCount;
  const fraction = item.type === 'movie' ? (item.progress && !item.progress.completed ? progressFraction(item.progress) : 0) : 0;
  const unwatchedEpisodes = item.type === 'show' ? item.episodeCount - item.watchedCount : 0;
  const playName = t('continueWatching.playName', { name: item.title });
  const detailsName = t('continueWatching.details', { name: item.title });
  const openShow = async () => {
    if (openingShow || item.type !== 'show') return;
    setOpeningShow(true);
    try {
      const show = await api.get<ShowDetail>(`/api/shows/${item.id}`);
      navigate(seriesContinue(show)?.href ?? href);
    } catch (error) {
      toast.error(error);
    } finally {
      setOpeningShow(false);
    }
  };
  const poster = (
    <div className={`relative overflow-hidden rounded-[var(--radius-card)] ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-accent/60 ${gridActions ? 'group-focus-within:ring-2 group-focus-within:ring-accent' : 'group-focus-visible:ring-2 group-focus-visible:ring-accent'}`}>
      <Artwork path={item.posterPath} title={item.title} />
      {watched && (
        <span className="absolute top-2 right-2 z-10 grid size-6 place-items-center rounded-full bg-ok text-bg shadow" title={t('library.watched')}>
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}
      {item.type === 'show' && !watched && item.watchedCount > 0 && unwatchedEpisodes > 0 && (
        <span className="absolute top-2 right-2 z-10 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink" title={t('library.unwatchedCount', { count: unwatchedEpisodes })}>
          {unwatchedEpisodes}
        </span>
      )}
      <CardDetails item={item} withProgress={fraction > 0} />
      {fraction > 0 && <ProgressBar value={fraction} className={`absolute inset-x-2 bottom-2 z-10 w-auto ${gridActions ? '!right-20' : ''}`} />}
    </div>
  );
  const title = (
    <>
      <p className="mt-2 truncate text-sm font-medium text-ink/90 group-hover:text-ink">{item.title}</p>
      <p className="text-xs text-faint">{item.year ?? (item.type === 'show' ? t('series.episodeCount', { count: item.episodeCount }) : '\u00a0')}</p>
    </>
  );
  if (!gridActions) {
    return <Link to={href} className={`group block focus-visible:outline-none ${className}`}>{poster}{title}</Link>;
  }
  return (
    <div className={`group ${className}`}>
      <div className="relative">
        <Link to={href} className="block focus-visible:outline-none">{poster}</Link>
        <div className="absolute right-2 bottom-2 z-20 flex items-center gap-1">
          {item.type === 'movie' ? (
            <Link
              to={playHref('movie', item.id, resumePoint(item.progress))}
              aria-label={playName}
              title={playName}
              className="grid size-9 place-items-center rounded-full border border-white/25 bg-black/75 text-white shadow-lg transition hover:bg-accent hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              <Play className="size-4 fill-current" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void openShow()}
              disabled={openingShow}
              aria-label={playName}
              aria-busy={openingShow}
              title={playName}
              className="grid size-9 place-items-center rounded-full border border-white/25 bg-black/75 text-white shadow-lg transition hover:bg-accent hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-60"
            >
              <Play className="size-4 fill-current" />
            </button>
          )}
          <Link
            to={href}
            aria-label={detailsName}
            title={detailsName}
            className="grid size-9 place-items-center rounded-full border border-white/25 bg-black/75 text-white shadow-lg transition hover:bg-accent hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <CircleAlert className="size-4" />
          </Link>
        </div>
      </div>
      <Link to={href} className="block focus-visible:outline-none">{title}</Link>
    </div>
  );
}

/** "2008 • 2h 32m" for movies, "2008 • 5 Seasons" for series. */
export function cardFacts(item: Card): string {
  const second =
    item.type === 'movie' ? formatRuntime(item.runtime) : item.seasonCount > 0 ? t('series.seasonCountFact', { count: item.seasonCount }) : null;
  return [item.year, second].filter(Boolean).join(' • ');
}

/**
 * Details revealed over the poster on hover or keyboard focus. Uses only what the grid already
 * loaded (no request per hover), sits on top of the poster without changing the layout, and is
 * never shown on touch screens, where hover does not exist (Tailwind's hover variant only applies
 * to devices that can hover).
 */
function CardDetails({ item, withProgress }: { item: Card; withProgress: boolean }) {
  useT();
  const facts = cardFacts(item);
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black from-30% via-black/80 via-55% to-black/10 px-3 pt-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-has-[a:focus-visible]:opacity-100 motion-reduce:transition-none ${withProgress ? 'pb-5' : 'pb-3'}`}
    >
      <div className="translate-y-1 transition-transform duration-200 group-hover:translate-y-0 group-has-[a:focus-visible]:translate-y-0 motion-reduce:transition-none">
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
export interface ContinueActions {
  onDismiss?: (item: ContinueItem) => void;
  onMarkWatched?: (item: ContinueItem) => void;
}

/**
 * A Continue Watching entry: what it is (season and episode), where you are (32:14 / 48:21), and
 * Resume or Play. The menu has Start over, Mark as watched and Remove.
 */
export function ContinueCard({ item, onDismiss, onMarkWatched }: { item: ContinueItem } & ContinueActions) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const popupRef = useKeepOnScreen<HTMLDivElement>(menuOpen);
  const detailsHref = item.type === 'movie' ? `/movies/${item.id}` : `/shows/${item.showId}`;
  const started = isStarted(item);
  const detail = continueDetail(item);
  const position = continuePosition(item);
  const name = `${item.title}${detail ? `, ${detail}` : ''}`;
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);
  const menuItem = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-raised focus-visible:bg-raised focus-visible:outline-none';
  return (
    <div className="group relative w-72 shrink-0 sm:w-80">
      <Link to={detailsHref} className="block focus-visible:outline-none" aria-label={t('continueWatching.details', { name })}>
        <div className="relative overflow-hidden rounded-[var(--radius-card)] ring-1 ring-white/5 transition group-hover:ring-accent/60 group-has-[a:focus-visible]:ring-2 group-has-[a:focus-visible]:ring-accent">
          <Artwork path={item.imagePath ?? item.posterPath} size="w780" aspect="wide" title={item.title} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          {started && (
            <div className="absolute right-3 bottom-3 left-3">
              <ProgressBar value={item.percent / 100} />
            </div>
          )}
        </div>
      </Link>
      <div className="mt-2 flex items-start gap-2">
        <Link to={detailsHref} className="min-w-0 flex-1" tabIndex={-1}>
          <p className="truncate text-sm font-medium group-hover:text-ink">{item.title}</p>
          {detail && <p className="truncate text-xs text-muted">{detail}{item.type === 'episode' && item.episodeTitle ? ` · ${item.episodeTitle}` : ''}</p>}
          {position && <p className="text-xs text-faint tabular-nums">{position}</p>}
        </Link>
        <Link
          to={started ? resumeHref(item) : playHref(item.type, item.id)}
          aria-label={started ? t('continueWatching.resumeName', { name }) : t('continueWatching.playName', { name })}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-xs font-semibold text-bg transition hover:bg-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <Play className="size-3.5 fill-current" />
          {started ? t('player.resume') : t('player.play')}
        </Link>
        {(onDismiss || onMarkWatched) && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={t('continueWatching.moreActions', { name })}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="grid size-8 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              <MoreHorizontal className="size-4" />
            </button>
            {menuOpen && (
              <div ref={popupRef} role="menu" className="absolute right-0 bottom-10 z-20 w-52 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-2xl">
                {started && (
                  <Link role="menuitem" to={startOverHref(item)} className={menuItem}>
                    <RotateCcw className="size-4 text-muted" /> {t('player.startOver')}
                  </Link>
                )}
                {onMarkWatched && (
                  <button role="menuitem" type="button" className={menuItem} onClick={() => { setMenuOpen(false); onMarkWatched(item); }}>
                    <Check className="size-4 text-muted" /> {t('library.markWatched')}
                  </button>
                )}
                {onDismiss && (
                  <button role="menuitem" type="button" className={menuItem} onClick={() => { setMenuOpen(false); onDismiss(item); }}>
                    <X className="size-4 text-muted" /> {t('continueWatching.remove')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
