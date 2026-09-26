import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Check, CheckCheck, Eye, Play, Star } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { episodeCode, formatDate, formatRuntime, progressFraction, resolutionLabel } from '../lib/format';
import type { EpisodeSummary, SeasonDetail, ShowDetail } from '../lib/types';
import { CollectionLinks, DetailHero, MetaList } from '../components/DetailHero';
import { FavoriteButton, WatchlistButton } from '../components/FavoriteButton';
import { AdminItemMenu } from '../components/AdminItemMenu';
import { CastRow } from '../components/People';
import { Artwork } from '../components/Artwork';
import { ProgressBar } from '../components/ProgressBar';
import { ErrorState, PageLoader, Spinner } from '../components/States';
import { toast } from '../components/Toast';

function EpisodeRow({ ep, onToggleWatched }: { ep: EpisodeSummary; onToggleWatched: (ep: EpisodeSummary) => void }) {
  const watched = ep.progress?.completed;
  const fraction = ep.progress && !watched ? progressFraction(ep.progress) : 0;
  return (
    <li className="group flex gap-4 rounded-xl p-2 transition hover:bg-surface sm:gap-5 sm:p-3">
      <Link to={`/play/episode/${ep.id}`} className="relative w-36 shrink-0 overflow-hidden rounded-lg sm:w-56" aria-label={`Play episode ${ep.episodeNumber}`}>
        <Artwork path={ep.stillPath} size="w300" aspect="wide" title={ep.title ?? `Episode ${ep.episodeNumber}`} />
        <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100">
          <Play className="size-8 fill-white text-white" />
        </span>
        {fraction > 0 && <ProgressBar value={fraction} className="absolute inset-x-2 bottom-2 w-auto" />}
      </Link>
      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-faint">
              Episode {ep.episodeNumber}
              {ep.runtime ? <span className="ml-3">{formatRuntime(ep.runtime)}</span> : null}
              {ep.airDate ? <span className="ml-3 hidden sm:inline">{formatDate(ep.airDate)}</span> : null}
              {ep.height ? <span className="ml-3 hidden sm:inline">{resolutionLabel(Math.round((ep.height * 16) / 9), ep.height)}</span> : null}
            </p>
            <Link to={`/play/episode/${ep.id}`} className="mt-0.5 block truncate font-medium hover:text-accent">
              {ep.title ?? `Episode ${ep.episodeNumber}`}
            </Link>
          </div>
          <button
            type="button"
            onClick={() => onToggleWatched(ep)}
            className={`grid size-8 shrink-0 place-items-center rounded-full ${watched ? 'bg-ok/15 text-ok' : 'text-faint opacity-60 hover:bg-raised hover:text-ink group-hover:opacity-100'}`}
            aria-label={watched ? 'Mark as unwatched' : 'Mark as watched'}
            title={watched ? 'Mark as unwatched' : 'Mark as watched'}
          >
            {watched ? <Check className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {ep.overview && <p className="mt-1.5 line-clamp-2 text-sm text-muted sm:line-clamp-3">{ep.overview}</p>}
      </div>
    </li>
  );
}

export function ShowPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['show', id], queryFn: () => api.get<ShowDetail>(`/api/shows/${id}`) });
  const seasons = q.data?.seasons ?? [];
  const defaultSeason = q.data?.upNext?.seasonNumber ?? seasons.find((s) => s.seasonNumber > 0)?.seasonNumber ?? seasons[0]?.seasonNumber;
  const seasonParam = params.get('season');
  const current = seasonParam !== null && seasons.some((s) => String(s.seasonNumber) === seasonParam) ? Number(seasonParam) : defaultSeason;

  const season = useQuery({
    queryKey: ['show', id, 'season', current],
    enabled: current !== undefined,
    queryFn: () => api.get<SeasonDetail>(`/api/shows/${id}/seasons/${current}`),
  });

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id]);

  const watched = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/progress/watched', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['show', id] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: ['watchlist'] });
      void qc.invalidateQueries({ queryKey: ['shows'] });
    },
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const currentSeason = seasons.find((x) => x.seasonNumber === current);
  const allWatched = s.episodeCount > 0 && s.watchedCount >= s.episodeCount;
  const up = s.upNext;
  const resuming = up?.progress && !up.progress.completed && up.progress.positionSec >= 30;
  const creators = s.crew.filter((c) => c.role === 'Creator').map((c) => c.name);

  return (
    <div>
      <DetailHero backdropPath={s.backdropPath} posterPath={s.posterPath} title={s.title}>
        <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl">{s.title}</h1>
        <MetaList
          items={[
            s.year,
            s.network,
            s.status,
            `${seasons.filter((x) => x.seasonNumber > 0).length || seasons.length} ${seasons.length === 1 ? 'season' : 'seasons'}`,
            `${s.watchedCount}/${s.episodeCount} watched`,
            s.rating ? (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5 fill-amber text-amber" />
                {s.rating.toFixed(1)}
              </span>
            ) : null,
          ]}
        />
        {s.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {s.genres.map((g) => (
              <Link key={g.id} to={`/shows?genre=${g.id}`} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-accent hover:text-ink">
                {g.name}
              </Link>
            ))}
          </div>
        )}
        <CollectionLinks collections={s.collections} />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {up && (
            <Link to={`/play/episode/${up.id}`} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 font-semibold text-bg hover:bg-white">
              <Play className="size-5 fill-current" />
              {resuming ? 'Resume' : s.watchedCount > 0 ? 'Play next' : 'Play'} {episodeCode(up.seasonNumber, up.episodeNumber)}
            </Link>
          )}
          <WatchlistButton key={String(s.watchlist)} type="show" id={s.id} initial={s.watchlist} />
          <FavoriteButton type="show" id={s.id} initial={s.favorite} />
          <button
            type="button"
            onClick={() => watched.mutate({ showId: s.id, watched: !allWatched })}
            className={`grid size-12 place-items-center rounded-full border transition-colors ${allWatched ? 'border-ok/50 bg-ok/10 text-ok' : 'border-line bg-surface/70 text-muted hover:text-ink'}`}
            aria-label={allWatched ? 'Mark show as unwatched' : 'Mark show as watched'}
            title={allWatched ? 'Mark show as unwatched' : 'Mark show as watched'}
          >
            {allWatched ? <CheckCheck className="size-5" /> : <Eye className="size-5" />}
          </button>
          {user?.role === 'admin' && <AdminItemMenu type="show" id={s.id} collections={s.collections} query={s.match.parsedTitle} year={s.match.parsedYear} />}
        </div>
      </DetailHero>

      <div className="mt-10 px-4 sm:px-8">
        {s.overview && <p className="max-w-3xl text-lg leading-relaxed text-ink/85">{s.overview}</p>}
        {creators.length > 0 && <p className="mt-3 text-sm text-muted">Created by {creators.join(', ')}</p>}
        {s.match.status === 'unmatched' && (
          <p className="mt-6 max-w-3xl rounded-lg bg-amber/10 px-4 py-3 text-sm text-amber">
            Velyx could not identify this show with confidence. {user?.role === 'admin' ? 'Use “Fix match” from the menu above.' : 'An administrator can fix the match.'}
          </p>
        )}
      </div>

      <section className="mt-12 px-4 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Seasons">
            {seasons.map((x) => (
              <button
                key={x.id}
                role="tab"
                aria-selected={x.seasonNumber === current}
                onClick={() => setParams({ season: String(x.seasonNumber) }, { replace: true })}
                className={`shrink-0 rounded-full px-4 py-2 text-sm transition ${x.seasonNumber === current ? 'bg-ink font-semibold text-bg' : 'text-muted hover:bg-raised hover:text-ink'}`}
              >
                {x.name}
                {x.episodeCount > 0 && x.watchedCount >= x.episodeCount && <Check className="ml-1.5 inline size-3.5" />}
              </button>
            ))}
          </div>
          {currentSeason && (
            <button
              type="button"
              className="text-sm text-muted hover:text-ink"
              onClick={() => watched.mutate({ seasonId: currentSeason.id, watched: currentSeason.watchedCount < currentSeason.episodeCount })}
            >
              {currentSeason.watchedCount < currentSeason.episodeCount ? 'Mark season as watched' : 'Mark season as unwatched'}
            </button>
          )}
        </div>
        {season.data?.overview && <p className="mt-4 max-w-3xl text-sm text-muted">{season.data.overview}</p>}
        {season.isLoading ? (
          <div className="grid h-40 place-items-center">
            <Spinner className="size-6" />
          </div>
        ) : season.error ? (
          <ErrorState error={season.error} onRetry={() => season.refetch()} />
        ) : (
          <ul className="mt-4 space-y-1">
            {season.data?.episodes.map((ep) => (
              <EpisodeRow key={ep.id} ep={ep} onToggleWatched={(e) => watched.mutate({ episodeId: e.id, watched: !e.progress?.completed })} />
            ))}
          </ul>
        )}
      </section>
      <CastRow cast={s.cast} />
    </div>
  );
}
