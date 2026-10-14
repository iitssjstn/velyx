import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { HardDriveDownload, PauseCircle, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import type { MovieDetail, SearchResults, SeasonDetail, ShowDetail } from '../../lib/types';
import { episodeCode, formatBytes } from '../../lib/format';
import { OptimizationControls } from '../../components/OptimizationControls';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/Modal';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

type Status = 'queued' | 'processing' | 'ready' | 'failed' | 'stale' | 'paused';

interface QueueItem {
  id: number;
  fileId: number;
  profile: 'compat-720p' | 'compat-1080p';
  status: Status;
  progress: number;
  position: number | null;
  outputSize: number | null;
  error: string | null;
  updatedAt: number;
  movieId: number | null;
  showId: number | null;
  title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  episodeTitle: string | null;
}

interface Queue { paused: boolean; items: QueueItem[] }

const TONE: Record<Status, string> = {
  queued: 'bg-raised text-muted',
  processing: 'bg-accent/15 text-accent',
  ready: 'bg-ok/15 text-ok',
  failed: 'bg-danger/15 text-danger',
  stale: 'bg-amber/15 text-amber',
  paused: 'bg-raised text-muted',
};

const ORDER: Status[] = ['processing', 'queued', 'paused', 'failed', 'stale', 'ready'];

function OptimizationSource() {
  const { t } = useT();
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const [episodeId, setEpisodeId] = useState<number | null>(null);
  const [fileId, setFileId] = useState<number | null>(null);
  const search = useDebounced(text.trim(), 200);
  const [kind, rawId] = target.split(':');
  const id = Number(rawId);
  const results = useQuery({
    queryKey: ['search', search],
    enabled: search.length > 0,
    queryFn: () => api.get<SearchResults>(`/api/search?q=${encodeURIComponent(search)}`),
  });
  const show = useQuery({
    queryKey: ['show', id],
    enabled: kind === 'show',
    queryFn: () => api.get<ShowDetail>(`/api/shows/${id}`),
  });
  const seasons = show.data?.seasons ?? [];
  const currentSeason = seasons.some((season) => season.seasonNumber === seasonNumber) ? seasonNumber : (seasons.find((season) => season.seasonNumber > 0) ?? seasons[0])?.seasonNumber;
  const season = useQuery({
    queryKey: ['show', id, 'season', currentSeason],
    enabled: kind === 'show' && currentSeason !== undefined && currentSeason !== null,
    queryFn: () => api.get<SeasonDetail>(`/api/shows/${id}/seasons/${currentSeason}`),
  });
  const episodes = season.data?.episodes ?? [];
  const currentEpisode = episodes.some((episode) => episode.id === episodeId) ? episodeId : episodes[0]?.id;
  const sourceKind = kind === 'show' ? 'episode' : kind;
  const sourceId = kind === 'show' ? currentEpisode : id;
  const source = useQuery({
    queryKey: ['admin', 'optimization-source', sourceKind, sourceId],
    enabled: (sourceKind === 'movie' || sourceKind === 'episode') && Boolean(sourceId),
    queryFn: () => api.get<Pick<MovieDetail, 'files'>>(`/api/${sourceKind === 'movie' ? 'movies' : 'episodes'}/${sourceId}`),
  });
  const files = source.data?.files ?? [];
  const selectedFile = files.find((file) => file.id === fileId) ?? files[0];
  // The search results as cards with their artwork; choosing one picks the title.
  const options = [
    ...(results.data?.movies ?? []).map((movie) => ({ value: `movie:${movie.id}`, title: movie.title, meta: movie.year ? String(movie.year) : null, image: movie.posterPath, wide: false })),
    ...(results.data?.shows ?? []).map((item) => ({ value: `show:${item.id}`, title: item.title, meta: item.year ? String(item.year) : null, image: item.posterPath, wide: false })),
    ...(results.data?.episodes ?? []).map((episode) => ({ value: `episode:${episode.id}`, title: `${episode.showTitle} · ${episodeCode(episode.seasonNumber, episode.episodeNumber)}`, meta: episode.title, image: episode.stillPath, wide: true })),
  ];
  const chosen = options.find((option) => option.value === target);
  const choose = (value: string) => {
    setTarget(value);
    setSeasonNumber(null);
    setEpisodeId(null);
    setFileId(null);
  };
  const error = results.error ?? show.error ?? season.error ?? source.error;

  return (
    <section className="space-y-3 border-b border-line/60 pb-6" aria-label={t('optimization.create')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span>{t('optimization.pick.search')}</span>
          <input type="search" className="input w-full" value={text} onChange={(event) => {
            setText(event.target.value);
            setTarget('');
            setSeasonNumber(null);
            setEpisodeId(null);
            setFileId(null);
          }} />
        </label>
        {chosen ? (
          <div className="flex items-center gap-3 sm:col-span-2">
            <div className={`${chosen.wide ? 'w-24' : 'w-12'} shrink-0`}>
              <Artwork path={chosen.image} size="w185" title={chosen.title} aspect={chosen.wide ? 'wide' : 'poster'} className="rounded-md" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{chosen.title}</p>
              {chosen.meta && <p className="truncate text-xs text-muted">{chosen.meta}</p>}
            </div>
            <Button size="sm" variant="ghost" onClick={() => choose('')}>{t('optimization.pick.change')}</Button>
          </div>
        ) : options.length > 0 && (
          <ul className="grid grid-cols-3 gap-3 sm:col-span-2 sm:grid-cols-5 lg:grid-cols-8" aria-label={t('optimization.pick.title')}>
            {options.map((option) => (
              <li key={option.value} className={option.wide ? 'col-span-2' : ''}>
                <button type="button" className="group w-full space-y-1.5 text-left focus-visible:outline-accent" onClick={() => choose(option.value)}>
                  <Artwork path={option.image} size={option.wide ? 'w300' : 'w185'} title={option.title} aspect={option.wide ? 'wide' : 'poster'} className="rounded-md ring-accent transition group-hover:ring-2" />
                  <span className="block truncate text-sm font-medium group-hover:text-accent">{option.title}</span>
                  {option.meta && <span className="block truncate text-xs text-muted">{option.meta}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {kind === 'show' && seasons.length > 0 && <label className="space-y-1 text-sm">
          <span>{t('optimization.pick.season')}</span>
          <select className="input w-full" value={currentSeason ?? ''} onChange={(event) => { setSeasonNumber(Number(event.target.value)); setEpisodeId(null); setFileId(null); }}>
            {seasons.map((item) => <option key={item.seasonNumber} value={item.seasonNumber}>{t('series.season', { n: item.seasonNumber })}</option>)}
          </select>
        </label>}
        {kind === 'show' && episodes.length > 0 && <label className="space-y-1 text-sm">
          <span>{t('optimization.pick.episode')}</span>
          <select className="input w-full" value={currentEpisode ?? ''} onChange={(event) => { setEpisodeId(Number(event.target.value)); setFileId(null); }}>
            {episodes.map((episode) => <option key={episode.id} value={episode.id}>{episodeCode(episode.seasonNumber, episode.episodeNumber)}{episode.title ? ` · ${episode.title}` : ''}</option>)}
          </select>
        </label>}
        {files.length > 0 && <label className="space-y-1 text-sm sm:col-span-2">
          <span>{t('optimization.sourceVersion')}</span>
          <select className="input w-full" value={selectedFile?.id ?? ''} onChange={(event) => setFileId(Number(event.target.value))}>
            {files.map((file) => <option key={file.id} value={file.id}>{file.fileName} · {file.height ? `${file.height}p` : t('optimization.unknownQuality')} · {formatBytes(file.size)}</option>)}
          </select>
        </label>}
      </div>
      {(results.isFetching || show.isFetching || season.isFetching || source.isFetching) && <p role="status" className="text-sm text-muted">{t('common.loading')}</p>}
      {error && <ErrorState error={error} onRetry={() => { void results.refetch(); if (kind === 'show') { void show.refetch(); if (currentSeason !== undefined) void season.refetch(); } if (sourceId) void source.refetch(); }} />}
      {search && !results.isFetching && !results.error && options.length === 0 && <p className="text-sm text-muted">{t('optimization.pick.noResults')}</p>}
      {((source.isSuccess && files.length === 0) || (kind === 'show' && season.isSuccess && episodes.length === 0)) && <p className="text-sm text-muted">{t('optimization.pick.noFiles')}</p>}
      {selectedFile && <OptimizationControls key={selectedFile.id} fileId={selectedFile.id} compact />}
    </section>
  );
}

export function OptimizationPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<QueueItem | null>(null);
  const q = useQuery({
    queryKey: ['admin', 'optimizations'],
    queryFn: () => api.get<Queue>('/api/admin/optimizations'),
    refetchInterval: (query) => (query.state.data?.items.some((item) => item.status === 'queued' || item.status === 'processing') ? 2000 : false),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'optimizations'] });
    void qc.invalidateQueries({ queryKey: ['optimizations'] });
  };
  const stop = useMutation({
    mutationFn: (item: QueueItem) => api.post(`/api/admin/optimizations/${item.id}/stop`),
    onSuccess: () => {
      toast.success(t('optimization.stopped'));
      refresh();
    },
    onError: (error) => toast.error(error),
  });
  const retry = useMutation({
    mutationFn: (item: QueueItem) => api.post(`/api/admin/media/${item.fileId}/optimizations`, { profile: item.profile }),
    onSuccess: () => {
      toast.success(t('optimization.queued'));
      refresh();
    },
    onError: (error) => toast.error(error),
  });
  const remove = useMutation({
    mutationFn: (item: QueueItem) => api.del(`/api/admin/optimizations/${item.id}`),
    onSuccess: () => {
      setRemoving(null);
      toast.success(t('optimization.removed'));
      refresh();
    },
    onError: (error) => toast.error(error),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState title={t('optimization.queue.loadError')} error={q.error} onRetry={() => q.refetch()} />;
  const { items, paused } = q.data;
  const profileLabel = (item: QueueItem) => (item.profile === 'compat-720p' ? t('optimization.p720') : t('optimization.p1080'));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold">{t('optimization.queue.title')}</h2>
      </div>

      <OptimizationSource />

      {paused && (
        <p role="status" className="panel flex items-center gap-2 p-3 text-sm text-amber">
          <PauseCircle className="size-4 shrink-0" aria-hidden="true" />{t('optimization.queue.paused')}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState icon={<HardDriveDownload className="size-6" />} title={t('optimization.queue.emptyTitle')}>{t('optimization.queue.empty')}</EmptyState>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2 text-xs">
            {ORDER.map((status) => {
              const count = items.filter((item) => item.status === status).length;
              return count > 0 && <li key={status} className={`rounded-full px-2.5 py-1 ${TONE[status]}`}>{t(`optimization.status.${status}`)}: {count}</li>;
            })}
          </ul>
          <ul className="panel divide-y divide-line/50 text-sm">
            {items.map((item) => {
              const href = item.movieId ? `/movies/${item.movieId}` : item.showId ? `/shows/${item.showId}` : null;
              const name = item.title ?? t('optimization.queue.unknownTitle');
              const detail = item.season !== null && item.episode !== null
                ? [episodeCode(item.season, item.episode), item.episodeTitle].filter(Boolean).join(' · ')
                : item.year ? String(item.year) : '';
              return (
                <li key={item.id} className="space-y-2 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      {href ? <Link to={href} className="font-medium hover:text-accent" title={t('optimization.queue.open')}>{name}</Link> : <span className="font-medium">{name}</span>}
                      {detail && <span className="ml-2 text-muted">{detail}</span>}
                    </div>
                    <span className="text-xs text-muted">{profileLabel(item)}{item.outputSize ? ` · ${formatBytes(item.outputSize)}` : ''}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[item.status]}`}>{t(`optimization.status.${item.status}`)}</span>
                    {(item.status === 'queued' || item.status === 'processing') && (
                      <Button size="sm" variant="secondary" icon={<Square className="size-4" />} loading={stop.isPending && stop.variables?.id === item.id} aria-label={`${t('optimization.stop')}: ${name}`} onClick={() => stop.mutate(item)}>
                        {t('optimization.stop')}
                      </Button>
                    )}
                    {(item.status === 'failed' || item.status === 'stale' || item.status === 'paused') && (
                      <Button size="sm" variant="secondary" icon={item.status === 'paused' ? <Play className="size-4" /> : <RotateCcw className="size-4" />} loading={retry.isPending && retry.variables?.id === item.id} disabled={stop.isPending && stop.variables?.id === item.id} onClick={() => retry.mutate(item)}>
                        {item.status === 'paused' ? t('optimization.resume') : t('optimization.retry')}
                      </Button>
                    )}
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-full hover:bg-raised hover:text-danger disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
                      aria-label={`${t('optimization.remove')}: ${name}`}
                      title={t('optimization.remove')}
                      disabled={item.status === 'processing' || (stop.isPending && stop.variables?.id === item.id)}
                      onClick={() => setRemoving(item)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {(item.status === 'processing' || item.status === 'paused') && (
                    <div className="space-y-1">
                      <div className="flex justify-between gap-2 text-xs text-muted"><span>{t(`optimization.status.${item.status}`)}</span><span>{item.progress}%</span></div>
                      <progress className="h-1.5 w-full accent-[var(--color-accent)]" max={100} value={item.progress} aria-label={`${name}: ${t('optimization.processing')}`} />
                    </div>
                  )}
                  {item.status === 'queued' && item.position !== null && <p className="text-xs text-muted">{t('optimization.queue.position', { n: item.position })}</p>}
                  {item.error && (item.status === 'failed' || item.status === 'stale') && (
                    <p className={`break-words text-xs ${item.status === 'failed' ? 'text-danger' : 'text-amber'}`}>{item.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ConfirmModal open={!!removing} title={t('optimization.removeTitle')} confirmLabel={t('optimization.remove')} danger loading={remove.isPending} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)}>
        {t('optimization.removeText')}
      </ConfirmModal>
    </div>
  );
}
