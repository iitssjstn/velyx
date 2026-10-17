import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, RotateCcw, Send, Star } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatRuntime } from '../lib/format';
import { DetailHero, MetaList } from '../components/DetailHero';
import { DiscoverCard, seerrDetailsHref, StateBadge, useOpenLocal, type SeerrResult } from '../components/Discover';
import { openState as open, RequestDialog, type SeerrDetails } from '../components/RequestDialog';
import { CastRow } from '../components/People';
import { ConfirmModal } from '../components/Modal';
import { Shelf } from '../components/Shelf';
import { TrailerButton } from '../components/TrailerButton';
import { DetailSkeleton, ErrorState } from '../components/States';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';
import { useT } from '../i18n';

/** Keyed by title, so going from one title to a similar one starts afresh. */
export function RequestPage() {
  const { type, id } = useParams();
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  return <RequestScreen key={`${mediaType}-${id}`} mediaType={mediaType} tmdbId={Number(id)} />;
}

/**
 * A title from Seerr on a page of its own: what it is, who is in it, requesting it (all or some
 * seasons of a show) or playing it when it is here, and titles like it.
 */
function RequestScreen({ mediaType, tmdbId }: { mediaType: 'movie' | 'tv'; tmdbId: number }) {
  const { t } = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { open: openLocal, busy } = useOpenLocal();
  const q = useQuery({ queryKey: ['seerr', 'details', mediaType, tmdbId], queryFn: () => api.get<SeerrDetails>(`/api/seerr/${mediaType}/${tmdbId}`) });
  const similar = useQuery({ queryKey: ['seerr', 'similar', mediaType, tmdbId], queryFn: () => api.get<{ results: SeerrResult[] }>(`/api/seerr/${mediaType}/${tmdbId}/recommendations`), enabled: q.isSuccess });
  const [confirming, setConfirming] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const reset = useMutation({
    mutationFn: () => api.del(`/api/admin/seerr/media/${mediaType}/${tmdbId}`),
    onSuccess: () => {
      toast.success(t('requests.page.resetDone', { title: q.data?.title ?? '' }));
      setConfirmReset(false);
      void qc.invalidateQueries({ queryKey: ['seerr'] });
    },
    onError: (e) => toast.error(e),
  });

  if (q.isLoading) return <DetailSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = { ...q.data, cast: q.data.cast ?? [], seasons: q.data.seasons ?? [], genres: q.data.genres ?? [] };
  const openSeasons = d.seasons.filter((s) => open(s.state));
  // A movie here is here; of a show, the seasons not here yet can still be requested (the server marks the ones it has).
  const canRequest = d.mediaType === 'movie' ? !d.inLibrary && open(d.state) : openSeasons.length > 0;
  const canReset = user?.role === 'admin' && !d.inLibrary && d.state !== null && d.state !== 'available' && d.state !== 'partiallyAvailable';
  const select = (item: SeerrResult) => navigate(seerrDetailsHref(item));

  return (
    <div className="pb-16">
      <DetailHero backdropPath={d.backdropPath} posterPath={d.posterPath} title={d.title}>
        <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl">{d.title}</h1>
        {d.tagline && <p className="mt-2 font-display text-lg text-ink/70 italic">{d.tagline}</p>}
        <MetaList
          items={[
            d.mediaType === 'movie' ? t('requests.movie') : t('requests.tv'),
            d.year,
            formatRuntime(d.runtime),
            d.mediaType === 'tv' && d.seasons.length > 0 ? t('requests.page.seasonsCount', { n: d.seasons.length }) : null,
            d.rating ? (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5 fill-amber text-amber" />
                {d.rating.toFixed(1)}
              </span>
            ) : null,
            d.inLibrary ? <span className="rounded-full bg-ok/15 px-2.5 py-0.5 text-xs text-ok">{t('requests.inLibrary')}</span> : d.state ? <StateBadge state={d.state} /> : null,
          ]}
        />
        {d.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {d.genres.map((g) => (
              <span key={g} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                {g}
              </span>
            ))}
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {d.local && (
            <button type="button" disabled={busy} onClick={() => void openLocal(d.local!)} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 font-semibold text-bg hover:bg-white disabled:opacity-60">
              <Play className="size-5 fill-current" />
              {t('requests.play')}
            </button>
          )}
          {canRequest && (
            <button
              type="button"
              // A show's seasons are chosen in the question that opens (nothing ticked beforehand).
              onClick={() => setConfirming(true)}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 font-semibold text-accent-ink hover:brightness-110 disabled:opacity-60"
            >
              <Send className="size-5" />
              {t('requests.request')}
            </button>
          )}
          <TrailerButton type={d.mediaType === 'movie' ? 'movie' : 'show'} id={d.tmdbId} title={d.title} outsideLibrary />
          {canReset && (
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setConfirmReset(true)}>
              {t('requests.page.reset')}
            </Button>
          )}
        </div>
        {canRequest && <p className="mt-3 text-sm text-faint">{t('requests.page.requestHint')}</p>}
      </DetailHero>

      <div className="mt-10 grid gap-10 px-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>{d.overview && <p className="max-w-3xl text-base leading-relaxed text-ink/90">{d.overview}</p>}</div>
        {d.mediaType === 'tv' && d.seasons.length > 0 && (
          <section aria-labelledby="seasons" className="rounded-[var(--radius-card)] border border-line bg-surface/70 p-4">
            <h2 id="seasons" className="label mb-3">
              {t('requests.seasons')}
            </h2>
            {/* What there is, and what was asked for before; the seasons to request are chosen after "Request". */}
            <ul className="space-y-1">
              {d.seasons.map((s) => (
                <li key={s.seasonNumber} className="flex items-center gap-3 px-2 py-1.5">
                  <span className="flex-1 text-sm">{t('requests.season', { n: s.seasonNumber, count: s.episodeCount })}</span>
                  {s.state && !open(s.state) && <StateBadge state={s.state} />}
                </li>
              ))}
            </ul>
            {!d.inLibrary && openSeasons.length === 0 && <p className="mt-3 text-sm text-muted">{t('requests.page.allRequested')}</p>}
          </section>
        )}
      </div>

      <div className="px-4 sm:px-8">
        <CastRow cast={d.cast.map((c) => ({ id: c.id, name: c.name, role: c.character, profilePath: c.profilePath }))} />
        {(similar.data?.results?.length ?? 0) > 0 && (
          <div className="mt-12">
            <Shelf title={t('requests.page.similar')}>
              {similar.data!.results.map((r) => (
                <DiscoverCard key={`${r.mediaType}-${r.tmdbId}`} item={r} onSelect={select} className="w-36 shrink-0 snap-start sm:w-40" />
              ))}
            </Shelf>
          </div>
        )}
      </div>

      <RequestDialog details={d} open={confirming} onClose={() => setConfirming(false)} />

      <ConfirmModal open={confirmReset} title={t('requests.page.resetTitle')} confirmLabel={t('requests.page.reset')} danger loading={reset.isPending} onConfirm={() => reset.mutate()} onClose={() => setConfirmReset(false)}>
        {t('requests.page.resetText', { title: d.title })}
      </ConfirmModal>
    </div>
  );
}
