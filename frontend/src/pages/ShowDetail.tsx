import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Check, Eye, Play, RotateCcw, Star } from 'lucide-react';
import { episodeHeading, episodePlayHref, episodeState, seasonName, seriesContinue, showStatus } from '../lib/series';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatRuntime, resolutionLabel } from '../lib/format';
import type { EpisodeSummary, SeasonDetail, ShowDetail } from '../lib/types';
import { CollectionLinks, DetailHero, MetaList } from '../components/DetailHero';
import { FavoriteButton, WatchlistButton } from '../components/FavoriteButton';
import { WatchedMenu } from '../components/WatchedMenu';
import { AdminItemMenu } from '../components/AdminItemMenu';
import { CastRow } from '../components/People';
import { MoreLikeThis } from '../components/MoreLikeThis';
import { Artwork } from '../components/Artwork';
import { ProgressBar } from '../components/ProgressBar';
import { ErrorState, PageLoader, Spinner } from '../components/States';
import { toast } from '../components/Toast';
import { useT } from '../i18n';

function EpisodeRow({ ep, onToggleWatched }: { ep: EpisodeSummary; onToggleWatched: (ep: EpisodeSummary) => void }) {
  const { t } = useT();
  const state = episodeState(ep);
  const heading = episodeHeading(ep);
  const href = episodePlayHref(ep);
  const action = state.kind === 'progress' ? t('player.resume') : t('player.play');
  return (
    <li className="group flex gap-4 rounded-xl p-2 transition hover:bg-surface sm:gap-5 sm:p-3">
      <Link to={href} className="relative w-36 shrink-0 overflow-hidden rounded-lg sm:w-56" aria-hidden tabIndex={-1}>
        <Artwork path={ep.stillPath} size="w300" aspect="wide" title={ep.title ?? t('series.episode', { n: ep.episodeNumber })} />
        <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100">
          <Play className="size-8 fill-white text-white" />
        </span>
        {state.kind === 'progress' && <ProgressBar value={state.percent / 100} className="absolute inset-x-2 bottom-2 w-auto" />}
        {state.kind === 'watched' && (
          <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-ok text-bg shadow" aria-hidden>
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{heading}</p>
            <p className="mt-0.5 text-xs text-faint">
              {ep.runtime ? <span>{formatRuntime(ep.runtime)}</span> : null}
              {state.kind === 'watched' && <span className="ml-3 text-ok">{t('library.watched')}</span>}
              {state.kind === 'progress' && <span className="ml-3 text-accent">{t('library.percentWatched', { percent: state.percent })}</span>}
              {ep.airDate ? <span className="ml-3 hidden sm:inline">{formatDate(ep.airDate)}</span> : null}
              {ep.height ? <span className="ml-3 hidden sm:inline">{resolutionLabel(Math.round((ep.height * 16) / 9), ep.height)}</span> : null}
            </p>
          </div>
          <Link
            to={href}
            aria-label={`${action} ${heading}`}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${state.kind === 'progress' ? 'bg-ink text-bg hover:bg-white' : 'bg-raised text-ink hover:bg-line'}`}
          >
            <Play className="size-3.5 fill-current" />
            {action}
          </Link>
          <button
            type="button"
            onClick={() => onToggleWatched(ep)}
            className={`grid size-8 shrink-0 place-items-center rounded-full ${state.kind === 'watched' ? 'bg-ok/15 text-ok' : 'text-faint opacity-60 hover:bg-raised hover:text-ink group-hover:opacity-100'}`}
            aria-label={state.kind === 'watched' ? t('library.markItemUnwatched', { name: heading }) : t('library.markItemWatched', { name: heading })}
            title={state.kind === 'watched' ? t('library.markUnwatched') : t('library.markWatched')}
          >
            {state.kind === 'watched' ? <Check className="size-4" /> : <Eye className="size-4" />}
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
  const { t } = useT();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['show', id], queryFn: () => api.get<ShowDetail>(`/api/shows/${id}`) });
  const seasons = q.data?.seasons ?? [];
  const defaultSeason = q.data?.upNext && seasons.some((s) => s.seasonNumber === q.data!.upNext!.seasonNumber) ? q.data.upNext.seasonNumber : (seasons.find((s) => s.seasonNumber > 0)?.seasonNumber ?? seasons[0]?.seasonNumber);
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
  const next = seriesContinue(s);
  const regularSeasons = seasons.filter((x) => x.seasonNumber > 0).length || seasons.length;
  const creators = s.crew.filter((c) => c.role === 'Creator').map((c) => c.name);

  return (
    <div>
      <DetailHero backdropPath={s.backdropPath} posterPath={s.posterPath} title={s.title}>
        <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl">{s.title}</h1>
        <MetaList
          items={[
            s.year,
            s.network,
            showStatus(s.status),
            t('series.seasonCount', { count: regularSeasons }),
            t('series.episodeCount', { count: s.episodeCount }),
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
        {s.watchedCount > 0 && (
          <div className="mt-4 flex max-w-sm items-center gap-3 text-sm text-muted" aria-label={t('library.percentWatched', { percent: s.percentWatched })}>
            <ProgressBar value={s.percentWatched / 100} className="flex-1" />
            <span className="tabular-nums">{t('library.percentWatched', { percent: s.percentWatched })}</span>
          </div>
        )}
        {next?.position && (
          <p className="mt-4 text-sm text-muted">
            {s.upNext!.title ? `${s.upNext!.title} · ` : ''}
            <span className="tabular-nums">{next.position}</span>
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {next && (
            <Link to={next.href} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 font-semibold whitespace-nowrap text-bg hover:bg-white">
              <Play className="size-5 fill-current" />
              {next.label}
            </Link>
          )}
          {next?.startOverHref && (
            <Link to={next.startOverHref} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink/10 px-5 font-medium whitespace-nowrap hover:bg-ink/20">
              <RotateCcw className="size-5" />
              {t('player.startOver')}
            </Link>
          )}
          <WatchlistButton key={String(s.watchlist)} type="show" id={s.id} initial={s.watchlist} />
          <FavoriteButton type="show" id={s.id} initial={s.favorite} />
          <WatchedMenu watchedCount={s.watchedCount} total={s.episodeCount} onMark={(value) => watched.mutate({ showId: s.id, watched: value })} />
          {user?.role === 'admin' && <AdminItemMenu type="show" id={s.id} collections={s.collections} query={s.match.parsedTitle} year={s.match.parsedYear} />}
        </div>
      </DetailHero>

      <div className="mt-10 px-4 sm:px-8">
        {s.overview && <p className="max-w-3xl text-lg leading-relaxed text-ink/85">{s.overview}</p>}
        {creators.length > 0 && <p className="mt-3 text-sm text-muted">{t('detail.createdBy', { names: creators.join(', ') })}</p>}
        {s.match.status === 'unmatched' && (
          <p className="mt-6 max-w-3xl rounded-lg bg-amber/10 px-4 py-3 text-sm text-amber">
            {t('detail.unmatchedShow')} {user?.role === 'admin' ? t('detail.unmatchedAdmin') : t('detail.unmatchedUser')}
          </p>
        )}
      </div>

      <section className="mt-12 px-4 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label={t('series.seasons')}>
            {seasons.map((x) => (
              <button
                key={x.id}
                role="tab"
                aria-selected={x.seasonNumber === current}
                onClick={() => setParams({ season: String(x.seasonNumber) }, { replace: true })}
                className={`shrink-0 rounded-full px-4 py-2 text-sm transition ${x.seasonNumber === current ? 'bg-ink font-semibold text-bg' : 'text-muted hover:bg-raised hover:text-ink'}`}
              >
                {seasonName(x)}
                {x.episodeCount > 0 && x.watchedCount >= x.episodeCount && <Check className="ml-1.5 inline size-3.5" aria-label={t('library.watched')} />}
              </button>
            ))}
          </div>
          {currentSeason && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-faint">
                {t('series.episodeCount', { count: currentSeason.episodeCount })}
                {currentSeason.watchedCount > 0 && ` · ${t('library.percentWatched', { percent: currentSeason.percentWatched })}`}
              </span>
              {currentSeason.watchedCount < currentSeason.episodeCount && (
                <button type="button" className="text-muted hover:text-ink" onClick={() => watched.mutate({ seasonId: currentSeason.id, watched: true })}>
                  {t('library.markSeasonWatched')}
                </button>
              )}
              {currentSeason.watchedCount > 0 && (
                <button type="button" className="text-muted hover:text-ink" onClick={() => watched.mutate({ seasonId: currentSeason.id, watched: false })}>
                  {t('library.markSeasonUnwatched')}
                </button>
              )}
            </div>
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
          <ul className="mt-4 space-y-1" aria-label={t('series.episodes')}>
            {season.data?.episodes.map((ep) => (
              <EpisodeRow key={ep.id} ep={ep} onToggleWatched={(e) => watched.mutate({ episodeId: e.id, watched: !e.progress?.completed })} />
            ))}
          </ul>
        )}
      </section>
      <CastRow cast={s.cast} />
      <MoreLikeThis type="show" id={s.id} />
    </div>
  );
}
