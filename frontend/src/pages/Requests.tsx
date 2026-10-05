import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Search as SearchIcon, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ConfirmModal } from '../components/Modal';
import { toast } from '../components/Toast';
import { api } from '../lib/api';
import { Button } from '../components/Button';
import { DiscoverCard, Poster, StateBadge, seerrDetailsHref, type MyRequest, type SeerrResult } from '../components/Discover';
import { ErrorState, PageLoader } from '../components/States';
import { useT } from '../i18n';

export type { RequestState, SeerrResult } from '../components/Discover';

type AdminRequest = MyRequest & { user: string | null };

/** Administrators: everyone's requests, and cancelling one (in Seerr and here). */
function AllRequests() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seerr', 'admin-requests'], queryFn: () => api.get<AdminRequest[]>('/api/admin/seerr/requests') });
  const [cancelling, setCancelling] = useState<AdminRequest | null>(null);
  const cancel = useMutation({
    mutationFn: (r: AdminRequest) => api.del<{ ok: boolean; inSeerr: boolean }>(`/api/admin/seerr/requests/${r.id}`),
    onSuccess: (res, r) => {
      toast.success(res.inSeerr ? t('requests.cancelled', { title: r.title }) : t('requests.cancelledHere', { title: r.title }));
      setCancelling(null);
      void qc.invalidateQueries({ queryKey: ['seerr'] });
    },
    onError: (e) => toast.error(e),
  });
  if (!q.data) return null;
  return (
    <section aria-labelledby="all-requests" className="space-y-3">
      <div>
        <h2 id="all-requests" className="font-display text-xl font-semibold">{t('requests.all')}</h2>
        <p className="text-sm text-muted">{t('requests.allHint')}</p>
      </div>
      {q.data.length === 0 ? (
        <p className="text-sm text-muted">{t('requests.noneAll')}</p>
      ) : (
        <ul className="panel divide-y divide-line/60">
          {q.data.map((r) => (
            <li key={r.id} className="flex items-center gap-4 p-3">
              <div className="w-10 shrink-0">
                <Poster path={r.posterPath} title={r.title} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="text-xs text-muted">
                  {r.mediaType === 'movie' ? t('requests.movie') : t('requests.tv')} · {r.user ?? t('requests.unknownUser')} · {new Date(r.createdAt).toLocaleDateString()}
                </p>
              </div>
              <StateBadge state={r.state} />
              <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setCancelling(r)} aria-label={t('requests.cancelOf', { title: r.title })}>
                <span className="hidden sm:inline">{t('requests.cancel')}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal
        open={!!cancelling}
        title={t('requests.cancelTitle')}
        confirmLabel={t('requests.cancel')}
        danger
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling)}
        onClose={() => setCancelling(null)}
      >
        {cancelling && t('requests.cancelText', { title: cancelling.title, user: cancelling.user ?? t('requests.unknownUser') })}
      </ConfirmModal>
    </section>
  );
}

/** Requests: search Seerr for what is not in the library, request it, and follow your requests. */
export function RequestsPage() {
  const { t } = useT();
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const select = (r: SeerrResult) => navigate(seerrDetailsHref(r));
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
        <Link to="/genres?scope=all&kind=movies" className="inline-flex text-sm font-medium text-accent hover:text-ink focus-visible:outline-accent">{t('browse.categoryTitle')}</Link>
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
                <DiscoverCard item={r} onSelect={select} className="w-full" />
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
                  <Link to={`/request/${r.mediaType}/${r.tmdbId}`} className="block truncate font-medium hover:text-accent">
                    {r.title}
                  </Link>
                  <p className="text-xs text-muted">{r.mediaType === 'movie' ? t('requests.movie') : t('requests.tv')} · {new Date(r.createdAt).toLocaleDateString()}</p>
                </div>
                <StateBadge state={r.state} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {user?.role === 'admin' && <AllRequests />}
    </div>
  );
}
