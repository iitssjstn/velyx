import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, RotateCcw, Send, Star } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatRuntime } from '../lib/format';
import { DetailHero, MetaList } from '../components/DetailHero';
import { DiscoverCard, StateBadge, useOpenLocal, type MyRequest, type RequestState, type SeerrResult } from '../components/Discover';
import { CastRow } from '../components/People';
import { ConfirmModal } from '../components/Modal';
import { Shelf } from '../components/Shelf';
import { TrailerButton } from '../components/TrailerButton';
import { seasonsToRequest, tickSeason } from '../lib/request-seasons';
import { DetailSkeleton, ErrorState } from '../components/States';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';
import { useT } from '../i18n';

export interface SeerrDetails extends SeerrResult {
  genres: string[];
  runtime: number | null;
  seasons: Array<{ seasonNumber: number; episodeCount: number; name: string | null; state: RequestState | null }>;
  backdropPath: string | null;
  tagline: string | null;
  rating: number | null;
  releaseDate: string | null;
  cast: Array<{ id: number; name: string; character: string | null; profilePath: string | null }>;
}

/** A season (or the title) may still be requested: never asked for, or turned down before. */
const open = (state: RequestState | null) => state === null || state === 'declined' || state === 'failed' || state === 'removed';

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
  // Nothing is ticked beforehand: the person picks the seasons they want (as in Seerr).
  const [chosen, setChosen] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const request = useMutation({
    mutationFn: () => api.post<MyRequest>('/api/seerr/requests', { mediaType, tmdbId, seasons: mediaType === 'tv' ? seasonsToRequest(chosen, (q.data?.seasons ?? []).filter((s) => open(s.state)).map((s) => s.seasonNumber)) : null }),
    onSuccess: (r) => {
      toast.success(t('requests.requested', { title: r.title }));
      setChosen([]);
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['seerr'] });
    },
    onError: (e) => toast.error(e),
  });
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
  const canRequest = !d.inLibrary && (d.mediaType === 'movie' ? open(d.state) : openSeasons.length > 0);
  // A show: only the seasons ticked (still open ones; none beforehand).
  const openNumbers = openSeasons.map((s) => s.seasonNumber);
  const picked = chosen.filter((n) => openNumbers.includes(n));
  const allPicked = openNumbers.length > 0 && picked.length === openNumbers.length;
  const toggle = (n: number, on: boolean) => setChosen(tickSeason(chosen, n, on));
  const canReset = user?.role === 'admin' && !d.inLibrary && d.state !== null && d.state !== 'available' && d.state !== 'partiallyAvailable';
  const select = (item: SeerrResult) => (item.local ? void openLocal(item.local) : navigate(`/request/${item.mediaType}/${item.tmdbId}`));

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
              disabled={request.isPending}
              // A show's seasons are chosen in the question that opens (nothing ticked beforehand).
              onClick={() => {
                setChosen([]);
                setConfirming(true);
              }}
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

      <ConfirmModal
        open={confirming}
        title={t('requests.page.confirmTitle', { title: d.title })}
        confirmLabel={d.mediaType === 'movie' || picked.length === 0 ? t('requests.request') : allPicked ? t('requests.requestAll') : t('requests.requestSeasons', { count: picked.length })}
        loading={request.isPending}
        // A show: at least one season ticked.
        confirmDisabled={d.mediaType === 'tv' && picked.length === 0}
        onConfirm={() => request.mutate()}
        onClose={() => setConfirming(false)}
      >
        {d.mediaType === 'movie' ? (
          <p>{t('requests.page.confirmMovie')}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p>{t('requests.page.pickSeasons')}</p>
              {openNumbers.length > 1 && (
                <button type="button" onClick={() => setChosen(allPicked ? [] : openNumbers)} className="shrink-0 text-sm font-medium text-accent hover:underline">
                  {allPicked ? t('requests.page.selectNone') : t('requests.page.selectAll')}
                </button>
              )}
            </div>
            <ul className="mt-3 max-h-[45vh] space-y-1 overflow-y-auto">
              {d.seasons.map((s) => {
                const free = open(s.state) && !d.inLibrary;
                return (
                  <li key={s.seasonNumber}>
                    <label className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-ink ${free ? 'cursor-pointer hover:bg-raised' : 'opacity-60'}`}>
                      <input type="checkbox" className="size-4 accent-[var(--color-accent)]" disabled={!free} checked={free ? picked.includes(s.seasonNumber) : false} onChange={(e) => toggle(s.seasonNumber, e.target.checked)} />
                      <span className="flex-1 text-sm">{t('requests.season', { n: s.seasonNumber, count: s.episodeCount })}</span>
                      {s.state && !open(s.state) && <StateBadge state={s.state} />}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="mt-3 text-sm">{t('requests.page.requestHint')}</p>
      </ConfirmModal>

      <ConfirmModal open={confirmReset} title={t('requests.page.resetTitle')} confirmLabel={t('requests.page.reset')} danger loading={reset.isPending} onConfirm={() => reset.mutate()} onClose={() => setConfirmReset(false)}>
        {t('requests.page.resetText', { title: d.title })}
      </ConfirmModal>
    </div>
  );
}
