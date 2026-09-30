import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

type Encoder = 'software' | 'vaapi' | 'nvenc';
interface TranscodingState {
  settings: { enabled: boolean; encoder: 'auto' | Encoder; maxStreams: number | null };
  support: { software: boolean; vaapi: string | null; nvenc: boolean; checkedAt: number } | null;
  /** The encoder in use (null: off, or none works). */
  inUse: Encoder | null;
  active: number;
}

/** Admin → Server: converting video the device cannot play (opt-in), and which encoder does it. */
export function TranscodingSettings() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'transcoding'], queryFn: () => api.get<TranscodingState>('/api/admin/transcoding') });
  const [draft, setDraft] = useState<{ enabled: boolean; encoder: 'auto' | Encoder; limit: string } | null>(null);
  const done = (d: TranscodingState) => {
    qc.setQueryData(['admin', 'transcoding'], d);
    setDraft(null);
  };
  const save = useMutation({
    mutationFn: (body: TranscodingState['settings']) => api.put<TranscodingState>('/api/admin/transcoding', body),
    onSuccess: (d) => {
      done(d);
      toast.success(t('server.transcoding.saved'));
    },
    onError: (e) => toast.error(e),
  });
  const detect = useMutation({ mutationFn: () => api.post<TranscodingState>('/api/admin/transcoding/detect'), onSuccess: done, onError: (e) => toast.error(e) });
  if (!q.data) return null;
  const d = q.data;
  const form = draft ?? { enabled: d.settings.enabled, encoder: d.settings.encoder, limit: d.settings.maxStreams ? String(d.settings.maxStreams) : '' };
  const set = (patch: Partial<typeof form>) => setDraft({ ...form, ...patch });
  const works = (e: Encoder) => (e === 'software' ? !!d.support?.software : e === 'vaapi' ? !!d.support?.vaapi : !!d.support?.nvenc);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const limit = form.limit.trim() ? Number(form.limit) : null;
    save.mutate({ enabled: form.enabled, encoder: form.encoder, maxStreams: limit });
  };
  return (
    <section className="panel space-y-4 p-5 sm:p-6" aria-labelledby="transcoding-title">
      <div>
        <h2 id="transcoding-title" className="font-display text-lg font-semibold">{t('server.transcoding.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('server.transcoding.description')}</p>
      </div>
      <p className="text-sm" role="status">
        {d.settings.enabled ? (
          d.inUse ? (
            <span className="text-ok">{t('server.transcoding.onWith', { encoder: t(`server.transcoding.encoders.${d.inUse}`) })}{d.active ? ` · ${t('server.transcoding.active', { n: d.active })}` : ''}</span>
          ) : (
            <span className="text-amber">{t('server.transcoding.noEncoder')}</span>
          )
        ) : (
          <span className="text-muted">{t('server.transcoding.off')}</span>
        )}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span className="text-sm">
            {t('server.transcoding.enable')}
            <span className="block text-xs text-faint">{t('server.transcoding.enableHint')}</span>
          </span>
        </label>
        <div>
          <label className="label" htmlFor="transcoding-encoder">{t('server.transcoding.encoder')}</label>
          <select id="transcoding-encoder" className="input" value={form.encoder} onChange={(e) => set({ encoder: e.target.value as typeof form.encoder })}>
            <option value="auto">{t('server.transcoding.auto')}</option>
            {(['nvenc', 'vaapi', 'software'] as const).map((e) => (
              <option key={e} value={e}>
                {t(`server.transcoding.encoders.${e}`)}
                {d.support ? ` — ${works(e) ? t('server.transcoding.works') : t('server.transcoding.notFound')}` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-faint">{t('server.transcoding.encoderHint')}</p>
        </div>
        <div>
          <label className="label" htmlFor="transcoding-limit">{t('server.transcoding.limit')}</label>
          <input id="transcoding-limit" className="input w-32" type="number" min={1} max={100} inputMode="numeric" placeholder={t('server.transcoding.noLimit')} value={form.limit} onChange={(e) => set({ limit: e.target.value })} />
          <p className="mt-1.5 text-xs text-faint">{t('server.transcoding.limitHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
          <Button variant="ghost" loading={detect.isPending} onClick={() => detect.mutate()}>{t('server.transcoding.detect')}</Button>
        </div>
      </form>
    </section>
  );
}
