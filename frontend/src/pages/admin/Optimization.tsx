import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { HardDriveDownload, PauseCircle, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { episodeCode, formatBytes } from '../../lib/format';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/Modal';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

type Status = 'queued' | 'processing' | 'ready' | 'failed' | 'stale';

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
};

const ORDER: Status[] = ['processing', 'queued', 'failed', 'stale', 'ready'];

export function OptimizationPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<QueueItem | null>(null);
  const q = useQuery({
    queryKey: ['admin', 'optimizations'],
    queryFn: () => api.get<Queue>('/api/admin/optimizations'),
    refetchInterval: (query) => (query.state.data?.items.some((item) => item.status === 'queued' || item.status === 'processing') ? 2000 : false),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'optimizations'] });
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
        <p className="mt-1 max-w-3xl text-sm text-muted">{t('optimization.queue.intro')}</p>
      </div>

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
                    {(item.status === 'failed' || item.status === 'stale') && (
                      <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} loading={retry.isPending && retry.variables?.id === item.id} onClick={() => retry.mutate(item)}>
                        {t('optimization.retry')}
                      </Button>
                    )}
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-full hover:bg-raised hover:text-danger disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
                      aria-label={`${t('optimization.remove')}: ${name}`}
                      title={t('optimization.remove')}
                      disabled={item.status === 'processing'}
                      onClick={() => setRemoving(item)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {item.status === 'processing' && (
                    <div className="space-y-1">
                      <div className="flex justify-between gap-2 text-xs text-muted"><span>{t('optimization.processing')}</span><span>{item.progress}%</span></div>
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
