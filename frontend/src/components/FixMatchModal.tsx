import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, qs } from '../lib/api';
import type { MatchCandidate } from '../lib/types';
import { Modal } from './Modal';
import { Button } from './Button';
import { Artwork } from './Artwork';
import { ErrorState, Spinner } from './States';
import { toast } from './Toast';
import { useT } from '../i18n';

/** Lets an administrator pick the correct TMDB entry for a movie or show. */
export function FixMatchModal({
  open,
  onClose,
  type,
  id,
  initialQuery,
  initialYear,
  onMatched,
}: {
  open: boolean;
  onClose: () => void;
  type: 'movie' | 'show';
  id: number;
  initialQuery: string;
  initialYear: number | null;
  onMatched?: (newId: number) => void;
}) {
  const qc = useQueryClient();
  const { t } = useT();
  const [query, setQuery] = useState(initialQuery);
  const [year, setYear] = useState(initialYear ? String(initialYear) : '');
  const [submitted, setSubmitted] = useState({ query: initialQuery, year: initialYear ? String(initialYear) : '' });

  const results = useQuery({
    queryKey: ['match-search', type, submitted.query, submitted.year],
    enabled: open && submitted.query.trim().length > 0,
    queryFn: () => api.get<MatchCandidate[]>(`/api/admin/match/search${qs({ type, query: submitted.query, year: submitted.year })}`),
  });

  const apply = useMutation({
    mutationFn: (tmdbId: number) => api.post<{ id: number }>('/api/admin/match', { type, id, tmdbId }),
    onSuccess: (res) => {
      toast.success(t('fixMatch.updated'));
      void qc.invalidateQueries();
      onClose();
      onMatched?.(res.id);
    },
    onError: (err) => toast.error(err),
  });

  const search = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted({ query: query.trim(), year: year.trim() });
  };

  return (
    <Modal title={t('adminItem.fixMatch')} open={open} onClose={onClose} wide>
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={type === 'movie' ? t('fixMatch.movieTitle') : t('fixMatch.showTitle')} aria-label={t('fixMatch.title')} />
        <input className="input w-24" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder={t('fixMatch.year')} aria-label={t('fixMatch.year')} inputMode="numeric" />
        <Button type="submit" icon={<Search className="size-4" />}>{t('common.search')}</Button>
      </form>
      <div className="mt-5 min-h-40">
        {results.isFetching ? (
          <div className="grid h-40 place-items-center"><Spinner className="size-6" /></div>
        ) : results.error ? (
          <ErrorState error={results.error} />
        ) : results.data && results.data.length === 0 ? (
          <p className="py-10 text-center text-muted">{t('fixMatch.noResults')}</p>
        ) : (
          <ul className="space-y-2">
            {results.data?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={apply.isPending}
                  onClick={() => apply.mutate(c.id)}
                  className="flex w-full items-start gap-4 rounded-xl p-2 text-left transition hover:bg-raised disabled:opacity-60"
                >
                  <div className="w-14 shrink-0 overflow-hidden rounded-md">
                    <Artwork path={c.posterPath} size="w92" title={c.title} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {c.title} {c.year && <span className="text-muted">({c.year})</span>}
                    </p>
                    {c.originalTitle && c.originalTitle !== c.title && <p className="text-sm text-faint">{c.originalTitle}</p>}
                    {c.overview && <p className="mt-1 line-clamp-2 text-sm text-muted">{c.overview}</p>}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${c.confidence >= 0.8 ? 'bg-ok/15 text-ok' : c.confidence >= 0.6 ? 'bg-amber/15 text-amber' : 'bg-raised text-muted'}`}
                    title={t('fixMatch.confidence')}
                  >
                    {Math.round(c.confidence * 100)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
