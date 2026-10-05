import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Film, Tv } from 'lucide-react';
import { DiscoverCard, DISCOVER_ROWS, seerrDetailsHref, type SeerrResult } from '../components/Discover';
import { PosterCard } from '../components/Cards';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, PageLoader } from '../components/States';
import { api } from '../lib/api';
import type { Card, Genre, Paged } from '../lib/types';
import { useT } from '../i18n';

type Kind = 'movies' | 'shows';
type Scope = 'all' | 'library' | 'seerr';
interface SeerrPage { page: number; totalPages: number; results: SeerrResult[] }
interface Category { key: string; name: string; localId?: number; seerrId?: number; count?: number }
type ResultItem = { source: 'library'; item: Card } | { source: 'seerr'; item: SeerrResult };

const control = (active: boolean) => `inline-flex min-h-9 items-center justify-center gap-2 rounded-full border px-3 text-sm transition ${active ? 'border-accent bg-accent/15 text-ink' : 'border-line text-muted hover:text-ink'}`;
const genreKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();

export function GenresPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawScope = params.get('scope');
  const scope: Scope = rawScope === 'library' || rawScope === 'seerr' ? rawScope : 'all';
  const kind: Kind = params.get('kind') === 'shows' ? 'shows' : 'movies';
  const row = kind === 'movies' ? 'movies' : 'tv';

  const localGenres = useQuery({
    queryKey: ['genres', kind],
    queryFn: () => api.get<Genre[]>(`/api/genres?type=${kind}`),
    enabled: scope !== 'seerr',
    staleTime: 5 * 60_000,
  });
  const seerrStatus = useQuery({
    queryKey: ['seerr', 'status'],
    queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'),
    enabled: scope !== 'library',
    staleTime: 5 * 60_000,
  });
  const seerrRows = DISCOVER_ROWS.filter((entry) => entry.genre !== undefined && entry.row === row);
  const genreChecks = useQueries({
    queries: seerrRows.map((entry) => ({
      queryKey: ['seerr', 'genre-index', entry.row, entry.genre],
      queryFn: () => api.get<SeerrPage>(`/api/seerr/discover?row=${entry.row}&genre=${entry.genre}&page=1`),
      enabled: scope !== 'library' && Boolean(seerrStatus.data?.enabled),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const catalogCategories: Category[] = seerrRows.flatMap((entry, index) => {
    if (!genreChecks[index]?.data?.results.length || !entry.genre) return [];
    const name = entry.genreName ? t(entry.genreName) : String(entry.genre);
    return [{ key: genreKey(name), name, seerrId: entry.genre }];
  });
  const categoriesByKey = new Map<string, Category>();
  if (scope !== 'seerr') {
    for (const genre of localGenres.data ?? []) {
      const key = genreKey(genre.name);
      categoriesByKey.set(key, { key, name: genre.name, localId: genre.id, count: genre.count });
    }
  }
  if (scope !== 'library') {
    for (const category of catalogCategories) {
      const existing = categoriesByKey.get(category.key);
      categoriesByKey.set(category.key, existing ? { ...existing, seerrId: category.seerrId } : category);
    }
  }
  const categories = [...categoriesByKey.values()].sort((a, b) => a.name.localeCompare(b.name));

  const legacyGenre = Number(params.get('genre')) || null;
  const localGenre = scope === 'all' ? Number(params.get('localGenre')) || null : scope === 'library' ? legacyGenre : null;
  const seerrGenre = scope === 'all' ? Number(params.get('seerrGenre')) || null : scope === 'seerr' ? legacyGenre : null;
  const selected = localGenre !== null || seerrGenre !== null;
  const selectedCategory = selected ? categories.find((category) =>
    (localGenre === null || category.localId === localGenre) && (seerrGenre === null || category.seerrId === seerrGenre),
  ) : undefined;
  const genreError = genreChecks.find((query) => query.error)?.error;
  const catalogIndexError = seerrStatus.error ?? genreError;
  const localResults = useInfiniteQuery({
    queryKey: ['library', kind, 'genre-results', localGenre],
    queryFn: ({ pageParam }) => api.get<Paged<Card>>(`/api/${kind}?page=${pageParam}&limit=60&sort=title&genre=${localGenre}`),
    initialPageParam: 1,
    getNextPageParam: (last) => last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    enabled: scope !== 'seerr' && localGenre !== null,
  });
  const catalogResults = useInfiniteQuery({
    queryKey: ['seerr', 'genre-results', row, seerrGenre],
    queryFn: ({ pageParam }) => api.get<SeerrPage>(`/api/seerr/discover?row=${row}&genre=${seerrGenre}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => last.page < last.totalPages ? last.page + 1 : undefined,
    enabled: scope !== 'library' && seerrGenre !== null && Boolean(seerrStatus.data?.enabled),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const changeView = (nextScope: Scope, nextKind: Kind) => setParams({ scope: nextScope, kind: nextKind }, { replace: true });
  const localItems = localResults.data?.pages.flatMap((page) => page.items) ?? [];
  const catalogItems = (catalogResults.data?.pages.flatMap((page) => page.results) ?? []).filter((item) => scope !== 'all' || !item.inLibrary);
  const items: ResultItem[] = [
    ...localItems.map((item): ResultItem => ({ source: 'library', item })),
    ...catalogItems.map((item): ResultItem => ({ source: 'seerr', item })),
  ];
  const selectedName = selectedCategory?.name ?? (scope === 'seerr' ? seerrRows.find((entry) => entry.genre === seerrGenre)?.genreName && t(seerrRows.find((entry) => entry.genre === seerrGenre)!.genreName!) : undefined);
  const indexLoading = (scope !== 'seerr' && localGenres.isLoading)
    || (scope !== 'library' && (seerrStatus.isLoading || (seerrStatus.data?.enabled && genreChecks.some((query) => query.isLoading))));
  const localActive = scope !== 'seerr' && localGenre !== null;
  const catalogActive = scope !== 'library' && seerrGenre !== null && Boolean(seerrStatus.data?.enabled);
  const resultsLoading = (localActive && localResults.isLoading) || (catalogActive && catalogResults.isLoading);
  const resultsError = (localActive && localResults.error) || (catalogActive && catalogResults.error);
  const retryResults = () => {
    if (localActive && localResults.error) void localResults.refetch();
    if (catalogActive && catalogResults.error) void catalogResults.refetch();
  };
  const retryCatalogIndex = () => {
    if (seerrStatus.error) void seerrStatus.refetch();
    genreChecks.forEach((query) => void query.refetch());
  };
  const chooseCategory = (category: Category) => {
    if (scope === 'seerr' && category.seerrId) setParams({ scope, kind, genre: String(category.seerrId) });
    else if (scope === 'all') setParams({ scope, kind, ...(category.localId ? { localGenre: String(category.localId) } : {}), ...(category.seerrId ? { seerrGenre: String(category.seerrId) } : {}) });
  };
  const loadMore = () => {
    if (localActive && localResults.hasNextPage && !localResults.isFetchingNextPage) void localResults.fetchNextPage();
    if (catalogActive && catalogResults.hasNextPage && !catalogResults.isFetchingNextPage) void catalogResults.fetchNextPage();
  };
  const hasNextPage = (localActive && localResults.hasNextPage) || (catalogActive && catalogResults.hasNextPage);
  const isFetchingNextPage = localResults.isFetchingNextPage || catalogResults.isFetchingNextPage;

  if (scope === 'library' && localGenre) return <Navigate to={`/${kind}?genre=${localGenre}`} replace />;

  return (
    <div className="w-full px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-6 flex items-start gap-3">
        {selected && scope !== 'library' && (
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
          <button type="button" aria-pressed={scope === 'all'} className={control(scope === 'all')} onClick={() => changeView('all', kind)}>{t('browse.categoryAll')}</button>
          <button type="button" aria-pressed={scope === 'library'} className={control(scope === 'library')} onClick={() => changeView('library', kind)}>{t('browse.categoryLibrary')}</button>
          <button type="button" aria-pressed={scope === 'seerr'} className={control(scope === 'seerr')} onClick={() => changeView('seerr', kind)}>{t('browse.categoryCatalog')}</button>
        </div>
        <div className="flex gap-2" role="group" aria-label={t('browse.categoryMediaType')}>
          <button type="button" aria-pressed={kind === 'movies'} className={control(kind === 'movies')} onClick={() => changeView(scope, 'movies')}><Film className="size-4" />{t('nav.movies')}</button>
          <button type="button" aria-pressed={kind === 'shows'} className={control(kind === 'shows')} onClick={() => changeView(scope, 'shows')}><Tv className="size-4" />{t('nav.tvShows')}</button>
        </div>
      </div>

      {scope === 'seerr' && seerrStatus.data?.enabled === false ? (
        seerrStatus.isLoading ? <PageLoader /> : <EmptyState title={t('browse.catalogNotEnabled')}>{t('browse.catalogNotEnabledHint')}</EmptyState>
      ) : scope === 'seerr' && seerrStatus.error ? (
        <ErrorState error={seerrStatus.error} onRetry={() => void seerrStatus.refetch()} />
      ) : !selected ? (
        indexLoading ? <PageLoader /> : (scope !== 'seerr' && localGenres.error) ? <ErrorState error={localGenres.error} onRetry={() => void localGenres.refetch()} /> : scope === 'seerr' && genreError ? <ErrorState error={genreError} onRetry={retryCatalogIndex} /> : categories.length === 0 && scope === 'all' && catalogIndexError ? (
          <ErrorState error={catalogIndexError} onRetry={retryCatalogIndex} />
        ) : categories.length === 0 ? (
          <EmptyState title={t('browse.noCategories')}>{scope === 'all' ? t('browse.noCategoriesEverywhere') : scope === 'seerr' ? t('browse.noCatalogCategories') : t(kind === 'movies' ? 'browse.noMovies' : 'browse.noShows')}</EmptyState>
        ) : (
          <>
            {scope === 'all' && catalogIndexError && <ErrorState error={catalogIndexError} onRetry={retryCatalogIndex} />}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {categories.map((genre) => (
                <li key={genre.key}>
                  {scope === 'library' ? (
                    <Link to={`/${kind}?genre=${genre.localId}`} className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-3 py-3 text-sm hover:text-accent focus-visible:outline-accent">
                      <span>{genre.name}</span><span className="text-xs text-faint">{genre.count}</span>
                    </Link>
                  ) : (
                    <button type="button" onClick={() => chooseCategory(genre)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-line px-3 py-3 text-left text-sm hover:text-accent focus-visible:outline-accent">
                      <span>{genre.name}</span>{genre.count !== undefined && <span className="text-xs text-faint">{genre.count}</span>}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )
      ) : resultsLoading ? <PageLoader /> : resultsError ? (
        <ErrorState error={resultsError} onRetry={retryResults} />
      ) : items.length === 0 && scope === 'all' && catalogIndexError ? (
        <ErrorState error={catalogIndexError} onRetry={retryCatalogIndex} />
      ) : items.length === 0 ? (
          <EmptyState title={t('browse.noCategories')}>{scope === 'seerr' ? t('browse.noCatalogCategories') : t('browse.noCategoriesEverywhere')}</EmptyState>
        ) : (
          <>
            {scope === 'all' && catalogIndexError && <ErrorState error={catalogIndexError} onRetry={retryCatalogIndex} />}
            <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
              {items.map((result) => <li key={result.source === 'library' ? `local-${result.item.type}-${result.item.id}` : `seerr-${result.item.mediaType}-${result.item.tmdbId}`}>
                {result.source === 'library'
                  ? <PosterCard item={result.item} className="w-full" />
                  : <DiscoverCard item={result.item} className="w-full" onSelect={(chosen) => navigate(seerrDetailsHref(chosen))} />}
              </li>)}
            </ul>
            {hasNextPage && <div className="flex justify-center py-8"><Button variant="secondary" loading={isFetchingNextPage} onClick={loadMore}>{t('browse.loadMore')}</Button></div>}
          </>
      )}
    </div>
  );
}