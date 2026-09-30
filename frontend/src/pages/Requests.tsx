import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search as SearchIcon, Send } from 'lucide-react';
import { api } from '../lib/api';
import { imageUrl } from '../lib/format';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ErrorState, PageLoader } from '../components/States';
import { toast } from '../components/Toast';
import { useT } from '../i18n';

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
}

interface SeerrDetails extends SeerrResult {
  genres: string[];
  runtime: number | null;
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
}

interface MyRequest {
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

function StateBadge({ state }: { state: RequestState }) {
  const { t } = useT();
  return <span className={`rounded-full px-2.5 py-0.5 text-xs ${TONE[state]}`}>{t(`requests.states.${state}`)}</span>;
}

function Poster({ path, title }: { path: string | null; title: string }) {
  return path ? (
    <img src={imageUrl(path, 'w342') ?? undefined} alt={title} loading="lazy" className="aspect-[2/3] w-full rounded-lg bg-raised object-cover" />
  ) : (
    <div className="grid aspect-[2/3] w-full place-items-center rounded-lg bg-raised px-2 text-center text-xs text-faint">{title}</div>
  );
}

/** One title: what it is, and requesting it (all or some seasons of a show). */
function DetailModal({ item, onClose }: { item: SeerrResult; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seerr', 'details', item.mediaType, item.tmdbId], queryFn: () => api.get<SeerrDetails>(`/api/seerr/${item.mediaType}/${item.tmdbId}`) });
  const [chosen, setChosen] = useState<number[] | null>(null);
  const request = useMutation({
    mutationFn: () => api.post<MyRequest>('/api/seerr/requests', { mediaType: item.mediaType, tmdbId: item.tmdbId, seasons: item.mediaType === 'tv' ? chosen : null }),
    onSuccess: (r) => {
      toast.success(t('requests.requested', { title: r.title }));
      void qc.invalidateQueries({ queryKey: ['seerr'] });
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  const d = q.data ?? { ...item, genres: [], runtime: null, seasons: [] };
  const canRequest = !d.inLibrary && (!d.state || d.state === 'declined' || d.state === 'failed');
  return (
    <Modal title={`${d.title}${d.year ? ` (${d.year})` : ''}`} open onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
        <div className="hidden sm:block">
          <Poster path={d.posterPath} title={d.title} />
        </div>
        <div className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 text-muted">
            <span>{d.mediaType === 'movie' ? t('requests.movie') : t('requests.tv')}</span>
            {d.genres.length > 0 && <span>· {d.genres.join(', ')}</span>}
            {d.runtime ? <span>· {t('requests.minutes', { n: d.runtime })}</span> : null}
            {d.inLibrary ? <span className="rounded-full bg-ok/15 px-2.5 py-0.5 text-xs text-ok">{t('requests.inLibrary')}</span> : d.state ? <StateBadge state={d.state} /> : null}
          </p>
          {d.overview && <p className="leading-relaxed">{d.overview}</p>}
          {d.mediaType === 'tv' && d.seasons.length > 0 && canRequest && (
            <fieldset className="space-y-1.5">
              <legend className="label">{t('requests.seasons')}</legend>
              {d.seasons.map((s) => (
                <label key={s.seasonNumber} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-accent)]"
                    checked={chosen === null || chosen.includes(s.seasonNumber)}
                    onChange={(e) => {
                      const all = d.seasons.map((x) => x.seasonNumber);
                      const now = chosen ?? all;
                      const next = e.target.checked ? [...now, s.seasonNumber] : now.filter((n) => n !== s.seasonNumber);
                      setChosen(next.length === all.length ? null : next);
                    }}
                  />
                  {t('requests.season', { n: s.seasonNumber, count: s.episodeCount })}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
            {canRequest && (
              <Button icon={<Send className="size-4" />} loading={request.isPending} disabled={chosen !== null && chosen.length === 0} onClick={() => request.mutate()}>
                {d.mediaType === 'movie' ? t('requests.request') : chosen === null ? t('requests.requestAll') : t('requests.requestSeasons', { count: chosen.length })}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Requests: search Seerr for what is not in the library, request it, and follow your requests. */
export function RequestsPage() {
  const { t } = useT();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<SeerrResult | null>(null);
  const status = useQuery({ queryKey: ['seerr', 'status'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr') });
  const results = useQuery({
    queryKey: ['seerr', 'search', query],
    queryFn: () => api.get<{ results: SeerrResult[] }>(`/api/seerr/search?q=${encodeURIComponent(query)}`),
    enabled: !!query && !!status.data?.enabled,
  });
  const mine = useQuery({ queryKey: ['seerr', 'requests'], queryFn: () => api.get<MyRequest[]>('/api/seerr/requests'), enabled: !!status.data?.enabled });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(input.trim());
  };
  if (status.isLoading) return <PageLoader />;
  if (status.error || !status.data) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  if (!status.data.enabled) return <ErrorState error={new Error(t('requests.admin.off'))} />;
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 pb-16 sm:px-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('requests.title')}</h1>
        <p className="max-w-2xl text-sm text-muted">{t('requests.intro')}</p>
      </div>
      <form onSubmit={submit} className="flex max-w-xl gap-2" role="search">
        <label htmlFor="seerr-q" className="sr-only">{t('requests.search')}</label>
        <input id="seerr-q" className="input flex-1" type="search" placeholder={t('requests.searchPlaceholder')} maxLength={100} value={input} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" icon={<SearchIcon className="size-4" />} disabled={!input.trim()} loading={results.isFetching}>{t('requests.search')}</Button>
      </form>

      {query && results.error && <ErrorState error={results.error} onRetry={() => results.refetch()} />}
      {query && results.data && (
        results.data.results.length === 0 ? (
          <p className="text-muted">{t('requests.noResults', { query })}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {results.data.results.map((r) => (
              <li key={`${r.mediaType}-${r.tmdbId}`}>
                <button type="button" onClick={() => setOpen(r)} className="group w-full space-y-2 text-left">
                  <div className="relative">
                    <Poster path={r.posterPath} title={r.title} />
                    {r.inLibrary && (
                      <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-ok text-black" title={t('requests.inLibrary')}>
                        <Check className="size-4" />
                      </span>
                    )}
                  </div>
                  <p className="truncate font-medium group-hover:text-accent">{r.title}</p>
                  <p className="flex items-center gap-2 text-xs text-muted">
                    {r.mediaType === 'movie' ? t('requests.movie') : t('requests.tv')}
                    {r.year ? ` · ${r.year}` : ''}
                    {!r.inLibrary && r.state && <StateBadge state={r.state} />}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      <section aria-labelledby="my-requests" className="space-y-3">
        <h2 id="my-requests" className="font-display text-xl font-semibold">{t('requests.mine')}</h2>
        {mine.data && mine.data.length === 0 && <p className="text-sm text-muted">{t('requests.none')}</p>}
        {mine.data && mine.data.length > 0 && (
          <ul className="panel divide-y divide-line/60">
            {mine.data.map((r) => (
              <li key={r.id} className="flex items-center gap-4 p-3">
                <div className="w-10 shrink-0">
                  <Poster path={r.posterPath} title={r.title} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="text-xs text-muted">{r.mediaType === 'movie' ? t('requests.movie') : t('requests.tv')} · {new Date(r.createdAt).toLocaleDateString()}</p>
                </div>
                <StateBadge state={r.state} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && <DetailModal item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
