import { useCallback, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Film, SlidersHorizontal, Sparkles, Tv, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Card, Genre, Paged } from '../lib/types';
import { PosterCard } from '../components/Cards';
import { EmptyState, ErrorState, PageLoader, Spinner } from '../components/States';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { VirtualGrid } from '../components/VirtualGrid';
import { toast } from '../components/Toast';
import { t, useT } from '../i18n';

type Kind = 'movies' | 'shows';

const SORTS = ['title', 'added', 'watched', 'release', 'year', 'rating', 'runtime'] as const;

export function watchFilters(kind: Kind) {
  return [
    { value: 'all', label: t('browse.filters.all') },
    { value: 'unwatched', label: t('library.unwatched') },
    { value: 'in-progress', label: t('browse.filters.inProgress') },
    { value: kind === 'movies' ? 'watched' : 'completed', label: kind === 'movies' ? t('library.watched') : t('browse.filters.completed') },
    { value: 'favorites', label: t('nav.favorites') },
    { value: 'watchlist', label: t('nav.watchlist') },
  ];
}

const RESOLUTIONS = [
  { value: '4k', label: '4K' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: 'sd', label: 'SD' },
];
const RATINGS = ['5', '6', '7', '8'];
const PAGE_SIZE = 60;
/** Filter keys stored in the URL; everything but sort/order counts as "filtered". */
const FILTER_KEYS = ['filter', 'genre', 'resolution', 'hdr', 'yearFrom', 'yearTo', 'minRating', 'maxRuntime'] as const;

const minColumnWidth = () => (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 640px)').matches ? 160 : 136);
// Poster (2:3) + 8px gap + title (20px) + subtitle (16px).
const rowHeightFor = (w: number) => w * 1.5 + 46;

/** Human-readable chips for the active filters, each with the keys it clears. */
export function activeFilterChips(params: URLSearchParams, kind: Kind, genres: Genre[] = []): { label: string; keys: string[] }[] {
  const chips: { label: string; keys: string[] }[] = [];
  const filter = params.get('filter');
  if (filter && filter !== 'all') chips.push({ label: watchFilters(kind).find((f) => f.value === filter)?.label ?? filter, keys: ['filter'] });
  const genre = params.get('genre');
  if (genre) chips.push({ label: genres.find((g) => String(g.id) === genre)?.name ?? t('browse.genre'), keys: ['genre'] });
  const res = params.get('resolution');
  if (res) chips.push({ label: RESOLUTIONS.find((r) => r.value === res)?.label ?? res, keys: ['resolution'] });
  if (params.get('hdr')) chips.push({ label: 'HDR', keys: ['hdr'] });
  const from = params.get('yearFrom');
  const to = params.get('yearTo');
  if (from || to) chips.push({ label: from && to ? `${from}–${to}` : from ? t('browse.fromYear', { year: from }) : t('browse.untilYear', { year: to ?? '' }), keys: ['yearFrom', 'yearTo'] });
  const rating = params.get('minRating');
  if (rating) chips.push({ label: t('browse.ratingAtLeast', { rating }), keys: ['minRating'] });
  const runtime = params.get('maxRuntime');
  if (runtime) chips.push({ label: t('browse.upToMinutes', { n: runtime }), keys: ['maxRuntime'] });
  return chips;
}

function FilterPanel({ kind, params, genres, onApply, onClose }: { kind: Kind; params: URLSearchParams; genres: Genre[]; onApply: (next: URLSearchParams) => void; onClose: () => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState(() => new URLSearchParams(params));
  const set = (key: string, value: string | null) =>
    setDraft((d) => {
      const n = new URLSearchParams(d);
      if (value === null || value === '' || (key === 'filter' && value === 'all')) n.delete(key);
      else n.set(key, value);
      return n;
    });
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? 'border-accent bg-accent/15 text-ink' : 'border-line text-muted hover:text-ink'}`;
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="label">{t('browse.show')}</legend>
        <div className="flex flex-wrap gap-2">
          {watchFilters(kind).map((f) => (
            <button key={f.value} type="button" aria-pressed={(draft.get('filter') ?? 'all') === f.value} className={chip((draft.get('filter') ?? 'all') === f.value)} onClick={() => set('filter', f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </fieldset>
      {kind === 'movies' && (
        <fieldset>
          <legend className="label">{t('browse.quality')}</legend>
          <div className="flex flex-wrap gap-2">
            {RESOLUTIONS.map((r) => (
              <button key={r.value} type="button" aria-pressed={draft.get('resolution') === r.value} className={chip(draft.get('resolution') === r.value)} onClick={() => set('resolution', draft.get('resolution') === r.value ? null : r.value)}>
                {r.label}
              </button>
            ))}
            <button type="button" aria-pressed={Boolean(draft.get('hdr'))} className={chip(Boolean(draft.get('hdr')))} onClick={() => set('hdr', draft.get('hdr') ? null : '1')}>
              HDR
            </button>
          </div>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="f-genre">{t('browse.genre')}</label>
          <select id="f-genre" className="input" value={draft.get('genre') ?? ''} onChange={(e) => set('genre', e.target.value)}>
            <option value="">{t('browse.allGenres')}</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-rating">{t('browse.rating')}</label>
          <select id="f-rating" className="input" value={draft.get('minRating') ?? ''} onChange={(e) => set('minRating', e.target.value)}>
            <option value="">{t('browse.anyRating')}</option>
            {RATINGS.map((r) => (
              <option key={r} value={r}>{r}+</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-from">{t('browse.yearFrom')}</label>
          <input id="f-from" className="input" type="number" inputMode="numeric" min={1870} max={2100} placeholder={t('browse.egYear', { year: 1990 })} value={draft.get('yearFrom') ?? ''} onChange={(e) => set('yearFrom', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-to">{t('browse.yearTo')}</label>
          <input id="f-to" className="input" type="number" inputMode="numeric" min={1870} max={2100} placeholder={t('browse.egYear', { year: 1999 })} value={draft.get('yearTo') ?? ''} onChange={(e) => set('yearTo', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            const n = new URLSearchParams(draft);
            FILTER_KEYS.forEach((k) => n.delete(k));
            setDraft(n);
          }}
        >
          {t('browse.reset')}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => onApply(draft)}>{t('browse.showResults')}</Button>
        </div>
      </div>
    </div>
  );
}

/** Saves the current filters as a smart collection (admin). */
function SaveSmartCollection({ kind, query, summary, onDone }: { kind: Kind; query: Record<string, string>; summary: string; onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useT();
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => api.post('/api/collections/smart', { name: name.trim(), kind, query }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['collections', 'smart'] });
      toast.success(t('smart.saved'));
      onDone();
      navigate('/collections');
    },
    onError: (err) => toast.error(err),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-muted">{kind === 'movies' ? t('smart.explainMovies', { summary }) : t('smart.explainShows', { summary })}</p>
      <div>
        <label className="label" htmlFor="smart-name">{t('common.name')}</label>
        <input id="smart-name" className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('smart.namePlaceholder')} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
      </div>
    </form>
  );
}

export function BrowsePage({ kind }: { kind: Kind }) {
  const { user } = useAuth();
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const [panel, setPanel] = useState(false);
  const sort = params.get('sort') ?? 'title';
  const order = params.get('order') ?? undefined;
  const [saving, setSaving] = useState(false);
  const title = kind === 'movies' ? t('nav.movies') : t('nav.tvShows');
  const query = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]));
  if (query.filter === 'all') query.filter = undefined;

  const genres = useQuery({ queryKey: ['genres', kind], queryFn: () => api.get<Genre[]>(`/api/genres?type=${kind}`), staleTime: 5 * 60_000 });
  const q = useInfiniteQuery({
    queryKey: [kind, 'list', sort, order, query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<Paged<Card>>(`/api/${kind}${qs({ page: pageParam, limit: PAGE_SIZE, sort, order, ...query })}`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const setSort = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'title') next.delete('sort');
    else next.set('sort', value);
    next.delete('order');
    setParams(next, { replace: true });
  };
  const clearKeys = (keys: string[]) => {
    const next = new URLSearchParams(params);
    keys.forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const chips = activeFilterChips(params, kind, genres.data);
  const filtered = chips.length > 0;

  return (
    <div className="px-4 pt-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          {q.data && <p className="mt-1 text-sm text-muted">{t(kind === 'movies' ? 'browse.movieCount' : 'browse.showCount', { count: total })}</p>}
        </div>
        <div className="flex gap-2">
          <select aria-label={t('browse.sort')} className="input h-10 w-auto py-0 pr-8 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.filter((s) => kind === 'movies' || s !== 'runtime').map((s) => (
              <option key={s} value={s}>{t(`browse.sorts.${s}`)}</option>
            ))}
          </select>
          <Button variant="secondary" icon={<SlidersHorizontal className="size-4" />} onClick={() => setPanel(true)} aria-label={filtered ? t('browse.filtersActive', { count: chips.length }) : t('browse.filtersTitle')}>
            <span className="hidden sm:inline">{t('browse.filtersTitle')}</span>
            {filtered && <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">{chips.length}</span>}
          </Button>
        </div>
      </div>

      {filtered && (
        <div className="mt-4 flex flex-wrap items-center gap-2" aria-label={t('browse.activeFilters')}>
          {chips.map((c) => (
            <button key={c.label} type="button" onClick={() => clearKeys(c.keys)} className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-sm text-ink/90 hover:bg-line" aria-label={t('browse.removeFilter', { label: c.label })}>
              {c.label}
              <X className="size-3.5 text-muted" />
            </button>
          ))}
          <button type="button" onClick={() => clearKeys([...FILTER_KEYS])} className="px-2 text-sm text-muted hover:text-ink">
            {t('browse.clearAll')}
          </button>
          {user?.role === 'admin' && (
            <button type="button" onClick={() => setSaving(true)} className="ml-auto inline-flex items-center gap-1.5 px-2 text-sm text-muted hover:text-ink">
              <Sparkles className="size-4" /> {t('smart.saveAs')}
            </button>
          )}
        </div>
      )}

      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={kind === 'movies' ? <Film className="size-6" /> : <Tv className="size-6" />}
          title={filtered ? t('browse.nothingMatches') : kind === 'movies' ? t('browse.noMovies') : t('browse.noShows')}
          action={
            filtered ? (
              <Button variant="secondary" onClick={() => clearKeys([...FILTER_KEYS])}>{t('browse.clearFilters')}</Button>
            ) : user?.role === 'admin' ? (
              <Link to="/admin/libraries" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-accent-ink">{t('home.manageLibraries')}</Link>
            ) : undefined
          }
        >
          {!filtered && (kind === 'movies' ? t('browse.addMoviesLibrary') : t('browse.addShowsLibrary'))}
        </EmptyState>
      ) : (
        <>
          <div className="mt-8">
            <VirtualGrid items={items} getKey={(i) => i.id} renderItem={(item) => <PosterCard item={item} />} minColumnWidth={minColumnWidth} rowHeightFor={rowHeightFor} onNearEnd={loadMore} />
          </div>
          <div className="flex justify-center py-10">
            {isFetchingNextPage ? <Spinner className="size-6" /> : hasNextPage ? <Button variant="secondary" onClick={loadMore}>{t('browse.loadMore')}</Button> : null}
          </div>
        </>
      )}

      <Modal title={t('smart.new')} open={saving} onClose={() => setSaving(false)}>
        {saving && (
          <SaveSmartCollection
            kind={kind}
            query={Object.fromEntries([...FILTER_KEYS, 'sort', 'order'].flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])))}
            summary={chips.map((c) => c.label).join(' · ')}
            onDone={() => setSaving(false)}
          />
        )}
      </Modal>
      <Modal title={t('browse.filtersTitle')} open={panel} onClose={() => setPanel(false)}>
        {panel && (
          <FilterPanel
            kind={kind}
            params={params}
            genres={genres.data ?? []}
            onClose={() => setPanel(false)}
            onApply={(next) => {
              setParams(next, { replace: true });
              setPanel(false);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
