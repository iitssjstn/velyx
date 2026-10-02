import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api } from '../lib/api';
import { imageUrl } from '../lib/format';
import { seriesContinue } from '../lib/series';
import type { ShowDetail } from '../lib/types';
import { Shelf } from './Shelf';
import { toast } from './Toast';
import { useT, type MessageKey } from '../i18n';

export type RequestState = 'requested' | 'approved' | 'processing' | 'partiallyAvailable' | 'available' | 'declined' | 'failed' | 'removed';

export interface SeerrResult {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  state: RequestState | null;
  inLibrary: boolean;
  /** Where it is on this server (only libraries you may see). */
  local: { type: 'movie' | 'show'; id: number } | null;
}

/**
 * Titles from Seerr for a search, when Seerr is set up: only what is not here (the library has
 * results of its own). Nothing is asked of Seerr without it.
 */
export function useCatalogSearch(query: string) {
  const status = useQuery({ queryKey: ['seerr', 'status'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const q = useQuery({
    queryKey: ['seerr', 'search', query],
    queryFn: () => api.get<{ results: SeerrResult[] }>(`/api/seerr/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0 && !!status.data?.enabled,
    staleTime: 60_000,
    retry: false,
  });
  const results = query ? (q.data?.results ?? []).filter((r) => !r.inLibrary) : [];
  return { enabled: !!status.data?.enabled, results, isFetching: q.isFetching, error: query ? q.error : null };
}

export interface MyRequest {
  id: number;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  posterPath: string | null;
  state: RequestState;
  createdAt: number;
}

const TONE: Record<RequestState, string> = {
  requested: 'bg-raised text-muted',
  approved: 'bg-accent/15 text-accent',
  processing: 'bg-accent/15 text-accent',
  partiallyAvailable: 'bg-ok/15 text-ok',
  available: 'bg-ok/15 text-ok',
  declined: 'bg-danger/15 text-danger',
  failed: 'bg-danger/15 text-danger',
  removed: 'bg-raised text-faint',
};

export function StateBadge({ state }: { state: RequestState }) {
  const { t } = useT();
  return <span className={`rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap ${TONE[state]}`}>{t(`requests.states.${state}`)}</span>;
}

export function Poster({ path, title }: { path: string | null; title: string }) {
  return path ? (
    <img src={imageUrl(path, 'w342') ?? undefined} alt={title} loading="lazy" className="aspect-[2/3] w-full rounded-lg bg-raised object-cover" />
  ) : (
    <div className="grid aspect-[2/3] w-full place-items-center rounded-lg bg-raised px-2 text-center text-xs text-faint">{title}</div>
  );
}

/**
 * Opens what is already here: a movie starts playing (with the usual "resume?" question), a show
 * goes on with its next episode (or its page when it has nothing to play).
 */
export function useOpenLocal() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const open = useCallback(
    async (local: NonNullable<SeerrResult['local']>) => {
      if (local.type === 'movie') return navigate(`/play/movie/${local.id}`);
      setBusy(true);
      try {
        const show = await api.get<ShowDetail>(`/api/shows/${local.id}`);
        navigate(seriesContinue(show)?.href ?? `/shows/${local.id}`);
      } catch (err) {
        toast.error(err);
      } finally {
        setBusy(false);
      }
    },
    [navigate],
  );
  return { open, busy };
}

/** A poster from Seerr: a check when it is here, the request's state when it is on its way. */
export function DiscoverCard({ item, onSelect, className = '' }: { item: SeerrResult; onSelect: (item: SeerrResult) => void; className?: string }) {
  const { t } = useT();
  return (
    <button type="button" onClick={() => onSelect(item)} className={`group block space-y-2 text-left focus-visible:outline-none ${className}`}>
      <div className="relative overflow-hidden rounded-lg ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-accent/60 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <Poster path={item.posterPath} title={item.title} />
        {item.inLibrary ? (
          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-ok text-bg shadow" title={t('requests.inLibrary')}>
            <Check className="size-4" strokeWidth={3} />
          </span>
        ) : item.state ? (
          <span className="absolute inset-x-2 bottom-2 flex justify-center">
            <StateBadge state={item.state} />
          </span>
        ) : null}
      </div>
      <p className="truncate text-sm font-medium text-ink/90 group-hover:text-ink">{item.title}</p>
      <p className="text-xs text-faint">
        {item.mediaType === 'movie' ? t('requests.movie') : t('requests.tv')}
        {item.year ? ` · ${item.year}` : ''}
      </p>
    </button>
  );
}

type Row = { row: 'trending' | 'movies' | 'tv' | 'upcomingMovies' | 'upcomingTv'; genre?: number; title: MessageKey; genreName?: MessageKey };

/** The catalog rows under the library on the home screen (TMDB genre ids). */
export const DISCOVER_ROWS: Row[] = [
  { row: 'trending', title: 'requests.discover.trending' },
  { row: 'movies', title: 'requests.discover.popularMovies' },
  { row: 'tv', title: 'requests.discover.popularShows' },
  { row: 'movies', genre: 28, title: 'requests.discover.movieGenre', genreName: 'requests.discover.genres.action' },
  { row: 'movies', genre: 35, title: 'requests.discover.movieGenre', genreName: 'requests.discover.genres.comedy' },
  { row: 'tv', genre: 80, title: 'requests.discover.showGenre', genreName: 'requests.discover.genres.crime' },
  { row: 'movies', genre: 18, title: 'requests.discover.movieGenre', genreName: 'requests.discover.genres.drama' },
  { row: 'movies', genre: 878, title: 'requests.discover.movieGenre', genreName: 'requests.discover.genres.scifi' },
  { row: 'tv', genre: 18, title: 'requests.discover.showGenre', genreName: 'requests.discover.genres.drama' },
  { row: 'movies', genre: 16, title: 'requests.discover.movieGenre', genreName: 'requests.discover.genres.animation' },
  { row: 'movies', genre: 10751, title: 'requests.discover.movieGenre', genreName: 'requests.discover.genres.family' },
  { row: 'tv', genre: 35, title: 'requests.discover.showGenre', genreName: 'requests.discover.genres.comedy' },
  { row: 'movies', genre: 53, title: 'requests.discover.movieGenre', genreName: 'requests.discover.genres.thriller' },
  { row: 'movies', genre: 27, title: 'requests.discover.movieGenre', genreName: 'requests.discover.genres.horror' },
  { row: 'tv', genre: 10765, title: 'requests.discover.showGenre', genreName: 'requests.discover.genres.fantasy' },
  { row: 'upcomingMovies', title: 'requests.discover.upcomingMovies' },
  { row: 'upcomingTv', title: 'requests.discover.upcomingShows' },
];

/** Becomes true once the element comes near the screen (and stays true). */
function useNear<T extends Element>(margin = '400px') {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}

/** A catalog row: loaded when it comes near, and loading its next page when scrolled to the end. */
function DiscoverShelf({ spec, onSelect }: { spec: Row; onSelect: (item: SeerrResult) => void }) {
  const { t } = useT();
  const [ref, near] = useNear<HTMLDivElement>();
  const q = useInfiniteQuery({
    queryKey: ['seerr', 'discover', spec.row, spec.genre ?? null],
    queryFn: ({ pageParam }) => api.get<{ page: number; totalPages: number; results: SeerrResult[] }>(`/api/seerr/discover?row=${spec.row}${spec.genre ? `&genre=${spec.genre}` : ''}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: near,
    staleTime: 10 * 60_000,
  });
  const [endRef, atEnd] = useNearEnd();
  useEffect(() => {
    if (atEnd && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [atEnd, q]);
  // The same title can come back on a later page.
  const seen = new Set<string>();
  const items = (q.data?.pages ?? []).flatMap((p) => p.results).filter((r) => {
    const k = `${r.mediaType}-${r.tmdbId}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const title = spec.genreName ? t(spec.title, { genre: t(spec.genreName) }) : t(spec.title);
  // Nothing (or Seerr away): the row is left out rather than shown empty.
  if (near && !q.isLoading && items.length === 0) return null;
  return (
    <div ref={ref} className="mt-10">
      <Shelf title={title}>
        {items.length === 0
          ? Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[2/3] w-36 shrink-0 animate-pulse rounded-lg bg-raised sm:w-40" />)
          : items.map((r) => <DiscoverCard key={`${r.mediaType}-${r.tmdbId}`} item={r} onSelect={onSelect} className="w-36 shrink-0 snap-start sm:w-40" />)}
        {q.hasNextPage && <div ref={endRef} className="w-8 shrink-0" aria-label={t('requests.discover.loadMore')} />}
      </Shelf>
    </div>
  );
}

/** Like useNear, but for the end of a horizontal row: true while it is in view. */
function useNearEnd() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { rootMargin: '0px 600px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return [setEl, inView] as const;
}

/**
 * Everything else there is to watch, from Seerr: rows of movies and shows under the library.
 * What is here plays right away; the rest is one click from a request.
 */
export function DiscoverShelves() {
  const status = useQuery({ queryKey: ['seerr', 'status'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const navigate = useNavigate();
  const { open } = useOpenLocal();
  if (!status.data?.enabled) return null;
  const select = (item: SeerrResult) => (item.local ? void open(item.local) : navigate(`/request/${item.mediaType}/${item.tmdbId}`));
  return (
    <div>
      {DISCOVER_ROWS.map((spec) => (
        <DiscoverShelf key={`${spec.row}-${spec.genre ?? ''}`} spec={spec} onSelect={select} />
      ))}
    </div>
  );
}
