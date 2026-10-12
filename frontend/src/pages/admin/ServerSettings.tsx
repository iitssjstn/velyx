import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';
import { useT } from '../../i18n';
import { useServerSettings } from './useServerSettings';

/**
 * Admin → Server: the server itself (its name, update checks, version and media folders). Settings about a
 * subject live on that subject's page: scanning on Libraries, TMDB on Metadata, detection on Intros &
 * credits, the maintenance window on Maintenance, transcoding on Playback and Seerr on Integrations.
 */
export function ServerSettingsPanel() {
  const { t } = useT();
  const { query: q, save } = useServerSettings();
  const [form, setForm] = useState({ serverName: '', updateCheck: true });

  useEffect(() => {
    if (q.data) setForm({ serverName: q.data.serverName, updateCheck: q.data.updateCheck });
  }, [q.data]);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ serverName: form.serverName.trim(), updateCheck: form.updateCheck });
  };

  return (
    <form onSubmit={submit} className="panel space-y-5 p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold">{t('settings.server.title')}</h2>
      <div className="max-w-sm">
        <label className="label" htmlFor="sname">{t('setup.serverName')}</label>
        <input id="sname" className="input" required maxLength={64} value={form.serverName} onChange={(e) => setForm({ ...form, serverName: e.target.value })} />
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.updateCheck} onChange={(e) => setForm({ ...form, updateCheck: e.target.checked })} />
        <span>
          {t('server.updateCheck')}
          <span className="block text-xs text-faint">{t('server.updateCheckHint')}</span>
        </span>
      </label>
      <dl className="grid gap-3 border-t border-line/60 pt-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-faint">{t('settings.server.version')}</dt>
          <dd>Vidalune {s.version}</dd>
        </div>
        <div>
          <dt className="text-faint">{t('server.mediaRoots')}</dt>
          <dd className="font-mono text-xs">{s.mediaRoots.join(', ')}</dd>
        </div>
      </dl>
      <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
    </form>
  );
}
