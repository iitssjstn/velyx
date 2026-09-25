import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { episodeCode, progressFraction } from '../lib/format';
import type { SearchResults } from '../lib/types';
import { PosterCard } from '../components/Cards';
import { Artwork } from '../components/Artwork';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState, ErrorState, Spinner } from '../components/States';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const query = useDebounced(text.trim(), 250);

  useEffect(() => {
    setParams(query ? { q: query } : {}, { replace: true });
  }, [query, setParams]);

  const q = useQuery({
    queryKey: ['search', query],
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => api.get<SearchResults>(`/api/search${qs({ q: query })}`),
  });
  const r = query ? q.data : undefined;
  const nothing = r && r.movies.length + r.shows.length + r.episodes.length === 0;

  return (
    <div className="px-4 pt-8 sm:px-8">
      <div className="relative max-w-2xl">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search movies, shows and episodes"
          aria-label="Search"
          className="input h-14 rounded-2xl pr-12 pl-12 text-lg [&::-webkit-search-cancel-button]:hidden"
        />
        {q.isFetching ? (
          <Spinner className="absolute top-1/2 right-4 size-5 -translate-y-1/2" />
        ) : text ? (
          <button type="button" onClick={() => setText('')} className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink" aria-label="Clear search">
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !query ? (
        <p className="mt-10 text-muted">Start typing to search your library.</p>
      ) : nothing ? (
        <EmptyState icon={<SearchIcon className="size-6" />} title={`Nothing found for “${query}”`}>
          Check the spelling or try part of the title.
        </EmptyState>
      ) : r ? (
        <div className="mt-10 space-y-12">
          {r.movies.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold">Movies</h2>
              <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
                {r.movies.map((m) => (
                  <PosterCard key={m.id} item={m} />
                ))}
              </div>
            </section>
          )}
          {r.shows.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold">TV Shows</h2>
              <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
                {r.shows.map((s) => (
                  <PosterCard key={s.id} item={s} />
                ))}
              </div>
            </section>
          )}
          {r.episodes.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold">Episodes</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {r.episodes.map((e) => (
                  <li key={e.id}>
                    <Link to={`/play/episode/${e.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface">
                      <div className="relative w-32 shrink-0 overflow-hidden rounded-lg">
                        <Artwork path={e.stillPath} size="w300" aspect="wide" title={e.title ?? e.showTitle} />
                        {e.progress && !e.progress.completed && <ProgressBar value={progressFraction(e.progress)} className="absolute inset-x-1.5 bottom-1.5 w-auto" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{e.title ?? `Episode ${e.episodeNumber}`}</p>
                        <p className="truncate text-sm text-muted">
                          {e.showTitle} <span className="text-faint">{episodeCode(e.seasonNumber, e.episodeNumber)}</span>
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}
