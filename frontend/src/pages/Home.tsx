import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clapperboard, Info, Play, RotateCcw } from 'lucide-react';
import { continueDetail, continuePosition, isStarted, resumeHref, startOverHref } from '../lib/continue';
import { api } from '../lib/api';
import { displayName, useAuth } from '../lib/auth';
import { greeting, imageUrl, progressFraction } from '../lib/format';
import type { Card, ContinueItem, HomeData } from '../lib/types';
import { toast } from '../components/Toast';
import { ContinueCard, PosterCard } from '../components/Cards';
import { Shelf } from '../components/Shelf';
import { EmptyState, ErrorState, PageLoader } from '../components/States';
import { ProgressBar } from '../components/ProgressBar';
import { useT } from '../i18n';

function Hero({ data }: { data: HomeData }) {
  const { t } = useT();
  const cw = data.hero;
  const featured: Card | undefined = data.recentlyAdded.find((c) => c.backdropPath) ?? data.recentlyAdded[0];
  if (!cw && !featured) return null;

  const title = cw ? cw.title : featured!.title;
  const backdrop = cw ? cw.imagePath : featured!.backdropPath;
  const overview = cw ? [continueDetail(cw), cw.type === 'episode' ? cw.episodeTitle : null].filter(Boolean).join(' · ') : featured!.overview;
  const started = cw ? isStarted(cw) : false;
  const playLink = cw ? resumeHref(cw) : featured!.type === 'movie' ? `/play/movie/${featured!.id}` : `/shows/${featured!.id}`;
  const infoHref = cw ? (cw.type === 'movie' ? `/movies/${cw.id}` : `/shows/${cw.showId}`) : featured!.type === 'movie' ? `/movies/${featured!.id}` : `/shows/${featured!.id}`;
  const src = imageUrl(backdrop, 'w1280');
  const fraction = cw && started ? progressFraction(cw.progress) : 0;
  const position = cw ? continuePosition(cw) : null;
  const featuredShow = !cw && featured!.type === 'show';

  return (
    <section className="relative mb-4 overflow-hidden">
      <div className="absolute inset-0">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover object-top opacity-70" />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(90%_120%_at_80%_0%,color-mix(in_oklab,var(--color-accent)_30%,transparent),transparent_70%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/75 to-bg/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/40" />
      </div>
      <div className={`relative flex flex-col justify-end px-4 pt-16 pb-8 sm:px-8 ${src ? 'min-h-[21rem] sm:min-h-[26rem]' : 'min-h-[15rem]'}`}>
        <p className="text-sm text-muted">{cw ? t('home.pickUp') : t('home.recentlyAddedHero')}</p>
        <h2 className="mt-1 max-w-2xl font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl">{title}</h2>
        {overview && <p className="mt-3 line-clamp-2 max-w-xl text-ink/80">{overview}</p>}
        {position && fraction > 0 && (
          <div className="mt-4 flex max-w-sm items-center gap-3 text-sm text-muted">
            <ProgressBar value={fraction} className="flex-1" />
            <span className="tabular-nums">{position}</span>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-2 sm:gap-3">
          <Link to={playLink} className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 font-semibold whitespace-nowrap text-bg transition hover:bg-white sm:h-12 sm:px-6">
            <Play className="size-5 fill-current" />
            {cw && started ? t('player.resume') : featuredShow ? t('home.episodes') : t('player.play')}
          </Link>
          {cw && started && (
            <Link to={startOverHref(cw)} className="inline-flex h-11 items-center gap-2 rounded-full bg-ink/10 px-4 font-medium whitespace-nowrap backdrop-blur transition hover:bg-ink/20 sm:h-12 sm:px-5">
              <RotateCcw className="size-5" />
              {t('player.startOver')}
            </Link>
          )}
          {!featuredShow && <Link to={infoHref} className="inline-flex h-11 items-center gap-2 rounded-full bg-ink/10 px-4 font-medium whitespace-nowrap backdrop-blur transition hover:bg-ink/20 sm:h-12 sm:px-5">
            <Info className="size-5" />
            {t('home.details')}
          </Link>}
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/api/home') });
  const dismiss = useMutation({
    mutationFn: (item: ContinueItem) => api.post('/api/home/continue/dismiss', { type: item.type, id: item.id }),
    // Remove the card right away; the server keeps it hidden until it is watched again.
    onMutate: (item) =>
      qc.setQueryData<HomeData>(['home'], (d) => (d ? { ...d, continueWatching: d.continueWatching.filter((c) => !(c.type === item.type && c.id === item.id)) } : d)),
    onError: (err) => {
      toast.error(err);
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
  });

  const markWatched = useMutation({
    mutationFn: (item: ContinueItem) => api.post('/api/progress/watched', { [item.type === 'movie' ? 'movieId' : 'episodeId']: item.id, watched: true }),
    // A movie leaves the list right away; a show comes back with its next episode after the refresh.
    onMutate: (item) =>
      qc.setQueryData<HomeData>(['home'], (d) => (d ? { ...d, continueWatching: d.continueWatching.filter((c) => !(c.type === item.type && c.id === item.id)) } : d)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['home'] }),
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const empty = d.counts.movies === 0 && d.counts.shows === 0;

  return (
    <div>
      <div className="px-4 pt-8 sm:px-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('home.greeting', { greeting: greeting(), name: displayName(user) })}
        </h1>
      </div>

      {empty ? (
        <EmptyState
          icon={<Clapperboard className="size-6" />}
          title={d.counts.libraries === 0 ? t('home.noLibraries') : t('home.librariesEmpty')}
          action={
            user?.role === 'admin' ? (
              <Link to="/admin/libraries" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-accent-ink">
                {d.counts.libraries === 0 ? t('home.addLibrary') : t('home.manageLibraries')}
              </Link>
            ) : undefined
          }
        >
          {user?.role === 'admin'
            ? d.counts.libraries === 0
              ? t('home.noLibrariesAdmin')
              : t('home.librariesEmptyAdmin')
            : t('home.noLibrariesUser')}
        </EmptyState>
      ) : (
        <>
          <Hero data={d} />
          {d.continueWatching.length > 0 && (
            <Shelf title={t('continueWatching.title')}>
              {d.continueWatching.map((c) => (
                <ContinueCard key={`${c.type}-${c.id}`} item={c} onDismiss={(item) => dismiss.mutate(item)} onMarkWatched={(item) => markWatched.mutate(item)} />
              ))}
            </Shelf>
          )}
          {d.recentlyAdded.length > 0 && (
            <Shelf title={t('home.recentlyAdded')}>
              {d.recentlyAdded.map((c) => (
                <PosterCard key={`${c.type}-${c.id}`} item={c} className="w-36 shrink-0 snap-start sm:w-40" />
              ))}
            </Shelf>
          )}
          {d.watchlist.length > 0 && (
            <Shelf title={t('home.yourWatchlist')} moreHref="/watchlist">
              {d.watchlist.map((c) => (
                <PosterCard key={`${c.type}-${c.id}`} item={c} className="w-36 shrink-0 snap-start sm:w-40" />
              ))}
            </Shelf>
          )}
          {d.favorites.length > 0 && (
            <Shelf title={t('home.yourFavorites')} moreHref="/favorites">
              {d.favorites.map((c) => (
                <PosterCard key={`${c.type}-${c.id}`} item={c} className="w-36 shrink-0 snap-start sm:w-40" />
              ))}
            </Shelf>
          )}
          {d.recentlyWatched.length > 0 && (
            <Shelf title={t('home.recentlyWatched')}>
              {d.recentlyWatched.map((c) => (
                <PosterCard key={`${c.type}-${c.id}`} item={c} className="w-36 shrink-0 snap-start sm:w-40" />
              ))}
            </Shelf>
          )}
          {d.movies.length > 0 && (
            <Shelf title={t('nav.movies')} moreHref="/movies">
              {d.movies.map((c) => (
                <PosterCard key={c.id} item={c} className="w-36 shrink-0 snap-start sm:w-40" />
              ))}
            </Shelf>
          )}
          {d.shows.length > 0 && (
            <Shelf title={t('nav.tvShows')} moreHref="/shows">
              {d.shows.map((c) => (
                <PosterCard key={c.id} item={c} className="w-36 shrink-0 snap-start sm:w-40" />
              ))}
            </Shelf>
          )}
        </>
      )}
    </div>
  );
}
