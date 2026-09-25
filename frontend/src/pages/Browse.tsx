import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Film, Tv } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Card, Genre, Paged } from '../lib/types';
import { PosterCard } from '../components/Cards';
import { EmptyState, ErrorState, PageLoader, Spinner } from '../components/States';
import { Button } from '../components/Button';

const SORTS = [
  { value: 'title', label: 'Title' },
  { value: 'added', label: 'Recently added' },
  { value: 'release', label: 'Release date' },
  { value: 'year', label: 'Year' },
  { value: 'rating', label: 'Rating' },
];
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unwatched', label: 'Unwatched' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'watched', label: 'Watched' },
];
const PAGE_SIZE = 60;

export function BrowsePage({ kind }: { kind: 'movies' | 'shows' }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') ?? 'title';
  const filter = params.get('filter') ?? 'all';
  const genre = params.get('genre') ?? '';
  const title = kind === 'movies' ? 'Movies' : 'TV Shows';

  const genres = useQuery({ queryKey: ['genres', kind], queryFn: () => api.get<Genre[]>(`/api/genres?type=${kind}`), staleTime: 5 * 60_000 });
  const q = useInfiniteQuery({
    queryKey: [kind, 'list', sort, filter, genre],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<Paged<Card>>(`/api/${kind}${qs({ page: pageParam, limit: PAGE_SIZE, sort, filter: filter === 'all' ? undefined : filter, genre })}`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });

  // Load the next page automatically when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !q.isFetchingNextPage) void q.fetchNextPage();
    }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);

  const update = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const filtered = filter !== 'all' || genre !== '';

  return (
    <div className="px-4 pt-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          {q.data && <p className="mt-1 text-sm text-muted">{total.toLocaleString()} {kind === 'movies' ? (total === 1 ? 'movie' : 'movies') : total === 1 ? 'show' : 'shows'}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filter" className="input h-10 w-auto py-0 pr-8 text-sm" value={filter} onChange={(e) => update('filter', e.target.value, 'all')}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <select aria-label="Genre" className="input h-10 w-auto py-0 pr-8 text-sm" value={genre} onChange={(e) => update('genre', e.target.value, '')}>
            <option value="">All genres</option>
            {genres.data?.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select aria-label="Sort" className="input h-10 w-auto py-0 pr-8 text-sm" value={sort} onChange={(e) => update('sort', e.target.value, 'title')}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={kind === 'movies' ? <Film className="size-6" /> : <Tv className="size-6" />}
          title={filtered ? 'Nothing matches these filters' : `No ${title.toLowerCase()} yet`}
          action={
            filtered ? (
              <Button variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>
            ) : user?.role === 'admin' ? (
              <Link to="/admin/libraries" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-accent-ink">Manage libraries</Link>
            ) : undefined
          }
        >
          {!filtered && `Add a ${kind === 'movies' ? 'Movies' : 'TV Shows'} library to see it here.`}
        </EmptyState>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
            {items.map((item) => (
              <PosterCard key={item.id} item={item} />
            ))}
          </div>
          <div ref={sentinel} className="flex justify-center py-10">
            {q.isFetchingNextPage ? <Spinner className="size-6" /> : q.hasNextPage ? <Button variant="secondary" onClick={() => q.fetchNextPage()}>Load more</Button> : null}
          </div>
        </>
      )}
    </div>
  );
}
