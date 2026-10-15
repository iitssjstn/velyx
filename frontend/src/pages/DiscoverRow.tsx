import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { DiscoverCard, DISCOVER_ROWS, ROW_PAGES, seerrDetailsHref, type SeerrResult } from '../components/Discover';
import { EmptyState, ErrorState, PageLoader, Spinner } from '../components/States';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { NotFoundPage } from './NotFound';

interface SeerrPage { page: number; totalPages: number; results: SeerrResult[] }

/** A catalog row from the home screen in full (Trending, Coming soon), as a grid that loads more as you scroll. */
export function DiscoverRowPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { row = '' } = useParams();
  const known = (ROW_PAGES as readonly string[]).includes(row);
  const spec = DISCOVER_ROWS.find((entry) => entry.row === row && entry.genre === undefined);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const status = useQuery({ queryKey: ['seerr', 'status'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const q = useInfiniteQuery({
    queryKey: ['seerr', 'discover', row, null],
    queryFn: ({ pageParam }) => api.get<SeerrPage>(`/api/seerr/discover?row=${row}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: known && Boolean(status.data?.enabled),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!hasNextPage || isFetchingNextPage || !node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
    }, { rootMargin: '500px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!known || !spec) return <NotFoundPage />;
  // The same title can come back on a later page.
  const seen = new Set<string>();
  const items = (q.data?.pages ?? []).flatMap((p) => p.results).filter((r) => {
    const k = `${r.mediaType}-${r.tmdbId}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });

  return (
    <div className="w-full px-4 pt-8 pb-16 sm:px-8">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t(spec.title)}</h1>
        <p className="mt-1 text-sm text-muted">{t('requests.discover.catalogHint')}</p>
      </div>
      {status.isLoading ? (
        <PageLoader />
      ) : status.error ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : !status.data?.enabled ? (
        <EmptyState title={t('browse.catalogNotEnabled')}>{t('requests.discover.rowNotEnabledHint')}</EmptyState>
      ) : q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={t('requests.discover.rowEmpty')} />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
            {items.map((item) => (
              <li key={`${item.mediaType}-${item.tmdbId}`}>
                <DiscoverCard item={item} className="w-full" onSelect={(chosen) => navigate(seerrDetailsHref(chosen))} />
              </li>
            ))}
          </ul>
          {hasNextPage && <div ref={loadMoreRef} className="flex min-h-12 justify-center py-4" aria-live="polite">{isFetchingNextPage && <Spinner className="size-6" />}</div>}
        </>
      )}
    </div>
  );
}
