import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Film, Tv } from 'lucide-react';
import { DiscoverCard, DISCOVER_ROWS, seerrDetailsHref, type SeerrResult } from '../components/Discover';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, PageLoader } from '../components/States';
import { api } from '../lib/api';
import type { Genre } from '../lib/types';
import { useT } from '../i18n';

type Kind = 'movies' | 'shows';
type Scope = 'library' | 'seerr';
interface SeerrPage { page: number; totalPages: number; results: SeerrResult[] }

const control = (active: boolean) => `inline-flex min-h-9 items-center justify-center gap-2 rounded-full border px-3 text-sm transition ${active ? 'border-accent bg-accent/15 text-ink' : 'border-line text-muted hover:text-ink'}`;

export function GenresPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope: Scope = params.get('scope') === 'seerr' ? 'seerr' : 'library';
  const kind: Kind = params.get('kind') === 'shows' ? 'shows' : 'movies';
  const selected = Number(params.get('genre')) || null;
  const row = kind === 'movies' ? 'movies' : 'tv';

  const localGenres = useQuery({
    queryKey: ['genres', kind],
    queryFn: () => api.get<Genre[]>(`/api/genres?type=${kind}`),
    enabled: scope === 'library',
    staleTime: 5 * 60_000,
  });
  const seerrStatus = useQuery({
    queryKey: ['seerr', 'status'],
    queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'),
    enabled: scope === 'seerr',
    staleTime: 5 * 60_000,
  });
  const seerrRows = DISCOVER_ROWS.filter((entry) => entry.genre !== undefined && entry.row === row);
  const genreChecks = useQueries({
    queries: seerrRows.map((entry) => ({
      queryKey: ['seerr', 'genre-index', entry.row, entry.genre],
      queryFn: () => api.get<SeerrPage>(`/api/seerr/discover?row=${entry.row}&genre=${entry.genre}&page=1`),
      enabled: scope === 'seerr' && Boolean(seerrStatus.data?.enabled),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const seerrGenres = seerrRows.flatMap((entry, index) => (genreChecks[index]?.data?.results.length ? [entry] : []));
  const genreError = genreChecks.find((query) => query.error)?.error;
  const results = useInfiniteQuery({
    queryKey: ['seerr', 'genre-results', row, selected],
    queryFn: ({ pageParam }) => api.get<SeerrPage>(`/api/seerr/discover?row=${row}&genre=${selected}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => last.page < last.totalPages ? last.page + 1 : undefined,
    enabled: scope === 'seerr' && Boolean(selected) && Boolean(seerrStatus.data?.enabled),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const changeView = (nextScope: Scope, nextKind: Kind) => setParams({ scope: nextScope, kind: nextKind }, { replace: true });
  const items = results.data?.pages.flatMap((page) => page.results) ?? [];
  const selectedName = scope === 'library'
    ? localGenres.data?.find((genre) => genre.id === selected)?.name
    : seerrRows.find((entry) => entry.genre === selected)?.genreName && t(seerrRows.find((entry) => entry.genre === selected)!.genreName!);

  if (scope === 'library' && selected) return <Navigate to={`/${kind}?genre=${selected}`} replace />;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-6 flex items-start gap-3">
        {selected && scope === 'seerr' && (
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => setParams({ scope, kind }, { replace: true })} aria-label={t('browse.allCategories')}>
            {t('browse.allCategories')}
          </Button>
        )}
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{selectedName ?? t('browse.categoryTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{t('browse.categoryIntro')}</p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-2" role="group" aria-label={t('browse.categorySource')}>
          <button type="button" aria-pressed={scope === 'library'} className={control(scope === 'library')} onClick={() => changeView('library', kind)}>{t('browse.categoryLibrary')}</button>
          <button type="button" aria-pressed={scope === 'seerr'} className={control(scope === 'seerr')} onClick={() => changeView('seerr', kind)}>{t('browse.categoryCatalog')}</button>
        </div>
        <div className="flex gap-2" role="group" aria-label={t('browse.categoryMediaType')}>
          <button type="button" aria-pressed={kind === 'movies'} className={control(kind === 'movies')} onClick={() => changeView(scope, 'movies')}><Film className="size-4" />{t('nav.movies')}</button>
          <button type="button" aria-pressed={kind === 'shows'} className={control(kind === 'shows')} onClick={() => changeView(scope, 'shows')}><Tv className="size-4" />{t('nav.tvShows')}</button>
        </div>
      </div>

      {scope === 'library' ? (
        localGenres.isLoading ? <PageLoader /> : localGenres.error ? <ErrorState error={localGenres.error} onRetry={() => void localGenres.refetch()} /> : (localGenres.data?.length ?? 0) === 0 ? (
          <EmptyState title={t('browse.noCategories')}>{t(kind === 'movies' ? 'browse.noMovies' : 'browse.noShows')}</EmptyState>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {localGenres.data!.map((genre) => (
              <li key={genre.id}>
                <Link to={`/${kind}?genre=${genre.id}`} className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-3 py-3 text-sm hover:text-accent focus-visible:outline-accent">
                  <span>{genre.name}</span><span className="text-xs text-faint">{genre.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : !seerrStatus.data?.enabled ? (
        seerrStatus.isLoading ? <PageLoader /> : seerrStatus.error ? <ErrorState error={seerrStatus.error} onRetry={() => void seerrStatus.refetch()} /> : <EmptyState title={t('browse.catalogNotEnabled')}>{t('browse.catalogNotEnabledHint')}</EmptyState>
      ) : selected ? (
        results.isLoading ? <PageLoader /> : results.error ? <ErrorState error={results.error} onRetry={() => void results.refetch()} /> : items.length === 0 ? (
          <EmptyState title={t('browse.noCategories')}>{t('browse.noCatalogCategories')}</EmptyState>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
              {items.map((item) => <li key={`${item.mediaType}-${item.tmdbId}`}><DiscoverCard item={item} className="w-full" onSelect={(chosen) => navigate(seerrDetailsHref(chosen))} /></li>)}
            </ul>
            {results.hasNextPage && <div className="flex justify-center py-8"><Button variant="secondary" loading={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>{t('browse.loadMore')}</Button></div>}
          </>
        )
      ) : genreChecks.some((query) => query.isLoading) ? <PageLoader /> : genreError ? <ErrorState error={genreError} onRetry={() => { void seerrStatus.refetch(); genreChecks.forEach((query) => void query.refetch()); }} /> : seerrGenres.length === 0 ? (
        <EmptyState title={t('browse.noCategories')}>{t('browse.noCatalogCategories')}</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {seerrGenres.map((entry) => (
            <li key={`${entry.row}-${entry.genre}`}>
              <button type="button" onClick={() => setParams({ scope, kind, genre: String(entry.genre) })} className="min-h-12 w-full border-b border-line px-3 py-3 text-left text-sm hover:text-accent focus-visible:outline-accent">
                {entry.genreName ? t(entry.genreName) : entry.genre}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}