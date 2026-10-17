import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { seasonsToRequest, tickSeason } from '../lib/request-seasons';
import { ConfirmModal } from './Modal';
import { StateBadge, type MyRequest, type RequestState, type SeerrResult } from './Discover';
import { toast } from './Toast';
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
export const openState = (state: RequestState | null) => state === null || state === 'declined' || state === 'failed' || state === 'removed';

/**
 * The question "Request …?": a movie as a whole, or the seasons of a show (nothing ticked
 * beforehand; what is here or asked for already cannot be ticked). Used on a title's request page
 * and on the page of a show that is here, so more seasons are asked for without leaving it.
 */
export function RequestDialog({ details: d, open, onClose }: { details: SeerrDetails; open: boolean; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<number[]>([]);
  const seasons = d.seasons ?? [];
  const openNumbers = seasons.filter((s) => openState(s.state)).map((s) => s.seasonNumber);
  const picked = chosen.filter((n) => openNumbers.includes(n));
  const allPicked = openNumbers.length > 0 && picked.length === openNumbers.length;
  const close = () => {
    setChosen([]);
    onClose();
  };
  const request = useMutation({
    mutationFn: () => api.post<MyRequest>('/api/seerr/requests', { mediaType: d.mediaType, tmdbId: d.tmdbId, seasons: d.mediaType === 'tv' ? seasonsToRequest(chosen, openNumbers) : null }),
    onSuccess: (r) => {
      toast.success(t('requests.requested', { title: r.title }));
      close();
      void qc.invalidateQueries({ queryKey: ['seerr'] });
    },
    onError: (e) => toast.error(e),
  });

  return (
    <ConfirmModal
      open={open}
      title={t('requests.page.confirmTitle', { title: d.title })}
      confirmLabel={d.mediaType === 'movie' || picked.length === 0 ? t('requests.request') : allPicked ? t('requests.requestAll') : t('requests.requestSeasons', { count: picked.length })}
      loading={request.isPending}
      // A show: at least one season ticked.
      confirmDisabled={d.mediaType === 'tv' && picked.length === 0}
      onConfirm={() => request.mutate()}
      onClose={close}
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
            {seasons.map((s) => {
              const free = openState(s.state);
              return (
                <li key={s.seasonNumber}>
                  <label className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-ink ${free ? 'cursor-pointer hover:bg-raised' : 'opacity-60'}`}>
                    <input type="checkbox" className="size-4 accent-[var(--color-accent)]" disabled={!free} checked={free ? picked.includes(s.seasonNumber) : false} onChange={(e) => setChosen(tickSeason(chosen, s.seasonNumber, e.target.checked))} />
                    <span className="flex-1 text-sm">{t('requests.season', { n: s.seasonNumber, count: s.episodeCount })}</span>
                    {s.state && !free && <StateBadge state={s.state} />}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-3 text-sm">{t('requests.page.requestHint')}</p>
    </ConfirmModal>
  );
}
