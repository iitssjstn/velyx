import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, HardDriveDownload, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from './Button';
import { ConfirmModal } from './Modal';
import { toast } from './Toast';
import { useT } from '../i18n';

type Profile = 'compat-720p' | 'compat-1080p';
interface Variant {
  id: number;
  profile: Profile;
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'stale';
  progress: number;
  outputSize: number | null;
  error: string | null;
  updatedAt: number;
}
interface OptimizationState { variants: Variant[] }

export function OptimizationControls({ fileId, compact = false }: { fileId: number; compact?: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [profile, setProfile] = useState<Profile>('compat-720p');
  const [removing, setRemoving] = useState<Variant | null>(null);
  const queryKey = ['optimizations', fileId];
  const q = useQuery({
    queryKey,
    queryFn: () => api.get<OptimizationState>(`/api/admin/media/${fileId}/optimizations`),
    refetchInterval: (query) => (query.state.data?.variants.some((variant) => variant.status === 'queued' || variant.status === 'processing') ? 2000 : false),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({ queryKey: ['admin', 'optimizations'] });
  };
  const create = useMutation({
    mutationFn: (selected: Profile) => api.post<{ variant: Variant }>(`/api/admin/media/${fileId}/optimizations`, { profile: selected }),
    onSuccess: (result) => {
      qc.setQueryData<OptimizationState>(queryKey, (previous) => ({ variants: [...(previous?.variants ?? []).filter((variant) => variant.id !== result.variant.id), result.variant] }));
      toast.success(t('optimization.queued'));
      refresh();
    },
    onError: (error) => toast.error(error),
  });
  const remove = useMutation({
    mutationFn: (variantId: number) => api.del(`/api/admin/optimizations/${variantId}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
      toast.success(t('optimization.removed'));
    },
    onError: (error) => toast.error(error),
  });
  const variants = q.data?.variants ?? [];
  const selected = variants.find((variant) => variant.profile === profile);
  const active = selected?.status === 'queued' || selected?.status === 'processing';
  const wrapper = compact ? 'mt-3 border-t border-line/50 pt-3' : 'panel space-y-3 p-4';

  return (
    <section className={wrapper} aria-label={t('optimization.title')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto flex items-center gap-2 text-sm font-semibold">
          <HardDriveDownload className="size-4 text-accent" aria-hidden="true" />{t('optimization.title')}
        </h3>
        {selected?.status === 'ready' && <span className="inline-flex items-center gap-1 text-xs text-ok"><Check className="size-3.5" />{t('optimization.ready')}</span>}
        <label className="sr-only" htmlFor={`optimization-profile-${fileId}`}>{t('optimization.profile')}</label>
        <select id={`optimization-profile-${fileId}`} className="input h-8 w-auto py-0 text-xs" value={profile} onChange={(event) => setProfile(event.target.value as Profile)}>
          <option value="compat-720p">{t('optimization.p720')}</option>
          <option value="compat-1080p">{t('optimization.p1080')}</option>
        </select>
        <Button size="sm" variant="secondary" icon={<HardDriveDownload className="size-4" />} loading={create.isPending} disabled={active || selected?.status === 'ready' || q.isLoading} onClick={() => create.mutate(profile)}>
          {selected?.status === 'failed' || selected?.status === 'stale' ? t('optimization.retry') : t('optimization.create')}
        </Button>
      </div>
      {!compact && <p className="text-xs text-muted">{t('optimization.originalKept')}</p>}
      {q.isError && <p className="text-xs text-danger">{t('optimization.statusError')}</p>}
      {selected && (selected.status === 'queued' || selected.status === 'processing') && (
        <div className="space-y-1" role="status">
          <div className="flex justify-between gap-2 text-xs text-muted"><span>{selected.status === 'queued' ? t('optimization.queued') : t('optimization.processing')}</span><span>{selected.progress}%</span></div>
          <progress className="h-1.5 w-full accent-[var(--color-accent)]" max={100} value={selected.progress} />
        </div>
      )}
      {selected?.status === 'failed' && <p className="text-xs text-danger">{selected.error || t('optimization.failed')}</p>}
      {selected?.status === 'stale' && <p className="text-xs text-amber">{t('optimization.stale')}</p>}
      {variants.length > 0 && (
        <ul className="space-y-1 border-t border-line/50 pt-2">
          {variants.map((variant) => (
            <li key={variant.id} className="flex items-center gap-2 text-xs text-muted">
              <span className="flex-1">{variant.profile === 'compat-720p' ? t('optimization.p720') : t('optimization.p1080')} · {t(`optimization.status.${variant.status}`)}</span>
              <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-raised hover:text-danger" aria-label={t('optimization.remove')} title={t('optimization.remove')} onClick={() => setRemoving(variant)}><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal open={!!removing} title={t('optimization.removeTitle')} confirmLabel={t('optimization.remove')} danger loading={remove.isPending} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing.id)}>
        {t('optimization.removeText')}
      </ConfirmModal>
    </section>
  );
}