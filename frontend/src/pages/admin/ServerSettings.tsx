import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ServerSettings } from '../../lib/types';
import { intervalLabel } from '../../lib/format';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

/** Server name/URL and TMDB configuration. The TMDB key is write-only: the API never returns it. */
export function ServerSettingsPanel() {
  const qc = useQueryClient();
  const { refetchServer } = useAuth();
  const { t, tRich } = useT();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<ServerSettings>('/api/admin/settings') });
  const [form, setForm] = useState({ serverName: '', serverUrl: '', tmdbLanguage: '', includeAdult: false, watchFolders: true, updateCheck: true, scanOnStartup: false, deferScansWhilePlaying: true, segmentDetection: true, segmentVideo: true });
  // '' = use SCAN_INTERVAL_MINUTES from the environment
  const [interval, setScanInterval] = useState('');
  const [key, setKey] = useState('');

  useEffect(() => {
    if (!q.data) return;
    setForm({ serverName: q.data.serverName, serverUrl: q.data.serverUrl, tmdbLanguage: q.data.tmdbLanguage, includeAdult: q.data.includeAdult, watchFolders: q.data.watchFolders, updateCheck: q.data.updateCheck, scanOnStartup: q.data.scanOnStartup, deferScansWhilePlaying: q.data.deferScansWhilePlaying, segmentDetection: q.data.segmentDetection, segmentVideo: q.data.segmentVideo });
    setScanInterval(q.data.scanIntervalSource === 'settings' ? String(q.data.scanIntervalMinutes) : '');
  }, [q.data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<ServerSettings>('/api/admin/settings', body),
    onSuccess: (data, body) => {
      qc.setQueryData(['admin', 'settings'], data);
      refetchServer();
      if ('tmdbApiKey' in body) {
        setKey('');
        toast.success(body.tmdbApiKey ? t('server.keySaved') : t('server.keyRemoved'));
      } else toast.success(t('server.saved'));
    },
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ ...form, serverName: form.serverName.trim(), serverUrl: form.serverUrl.trim(), tmdbLanguage: form.tmdbLanguage.trim(), scanIntervalMinutes: interval === '' ? null : Number(interval) });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="panel space-y-5 p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">{t('settings.server.title')}</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sname">{t('setup.serverName')}</label>
            <input id="sname" className="input" required maxLength={64} value={form.serverName} onChange={(e) => setForm({ ...form, serverName: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="surl">{t('server.url')}</label>
            <input id="surl" className="input" placeholder="https://velyx.example.com" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} />
            <p className="mt-1 text-xs text-faint">{t('server.urlHint')}</p>
          </div>
          <div>
            <label className="label" htmlFor="lang">{t('server.metadataLanguage')}</label>
            <input id="lang" className="input" placeholder="en-US" value={form.tmdbLanguage} onChange={(e) => setForm({ ...form, tmdbLanguage: e.target.value })} />
            <p className="mt-1 text-xs text-faint">{t('server.metadataLanguageHint')}</p>
          </div>
          <label className="flex items-center gap-3 self-center text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={form.includeAdult} onChange={(e) => setForm({ ...form, includeAdult: e.target.checked })} />
            {t('server.includeAdult')}
          </label>
          <label className="flex items-start gap-3 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.updateCheck} onChange={(e) => setForm({ ...form, updateCheck: e.target.checked })} />
            <span>
              {t('server.updateCheck')}
              <span className="block text-xs text-faint">{t('server.updateCheckHint')}</span>
            </span>
          </label>
        </div>
        <fieldset className="space-y-4 border-t border-line/60 pt-5">
          <legend className="sr-only">{t('server.scanning')}</legend>
          <h3 className="font-display text-base font-semibold">{t('server.scanning')}</h3>
          <p className="text-sm text-muted">{t('server.scanningText')}</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="interval">{t('dashboard.scheduledScans')}</label>
              <select id="interval" className="input" value={interval} onChange={(e) => setScanInterval(e.target.value)}>
                <option value="">{t('server.intervalDefault', { interval: intervalLabel(s.scanIntervalDefault).toLowerCase() })}</option>
                {[0, 60, 180, 360, 720, 1440].map((m) => (
                  <option key={m} value={m}>{intervalLabel(m)}</option>
                ))}
                {interval !== '' && ![0, 60, 180, 360, 720, 1440].includes(Number(interval)) && <option value={interval}>{intervalLabel(Number(interval))}</option>}
              </select>
              <p className="mt-1 text-xs text-faint">{t('server.intervalHint')}</p>
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.watchFolders} onChange={(e) => setForm({ ...form, watchFolders: e.target.checked })} />
            <span>
              {t('server.watchFolders')}
              <span className="block text-xs text-faint">{t('server.watchFoldersHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.scanOnStartup} onChange={(e) => setForm({ ...form, scanOnStartup: e.target.checked })} />
            <span>
              {t('server.scanOnStartup')}
              <span className="block text-xs text-faint">{t('server.scanOnStartupHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.deferScansWhilePlaying} onChange={(e) => setForm({ ...form, deferScansWhilePlaying: e.target.checked })} />
            <span>
              {t('server.defer')}
              <span className="block text-xs text-faint">{t('server.deferHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.segmentDetection} onChange={(e) => setForm({ ...form, segmentDetection: e.target.checked })} />
            <span>
              {t('server.segments')}
              <span className="block text-xs text-faint">{t('server.segmentsHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 pl-7 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.segmentVideo} disabled={!form.segmentDetection} onChange={(e) => setForm({ ...form, segmentVideo: e.target.checked })} />
            <span>
              {t('server.segmentVideo')}
              <span className="block text-xs text-faint">{t('server.segmentVideoHint')}</span>
            </span>
          </label>
        </fieldset>
        <dl className="grid gap-3 border-t border-line/60 pt-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-faint">{t('settings.server.version')}</dt>
            <dd>Velyx {s.version}</dd>
          </div>
          <div>
            <dt className="text-faint">{t('server.mediaRoots')}</dt>
            <dd className="font-mono text-xs">{s.mediaRoots.join(', ')}</dd>
          </div>
        </dl>
        <Button type="submit" loading={save.isPending && !('tmdbApiKey' in (save.variables ?? {}))}>{t('common.save')}</Button>
      </form>

      <section className="panel space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">{t('server.tmdbTitle')}</h2>
          <p className="mt-1 text-sm text-muted">
            {t('server.tmdbText')}
          </p>
        </div>
        <p className="text-sm">
          {t('server.status')}{' '}
          {s.tmdb.configured ? (
            <span className="text-ok">
              {tRich(s.tmdb.source === 'environment' ? 'server.configuredEnv' : 'server.configuredSettings', { hint: s.tmdb.hint ? <span className="font-mono">{s.tmdb.hint}</span> : '' })}
            </span>
          ) : (
            <span className="text-amber">{t('server.notConfigured')}</span>
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) save.mutate({ tmdbApiKey: key.trim() });
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            className="input min-w-0 flex-1 font-mono text-sm"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={s.tmdb.configured ? t('server.newKey') : t('server.keyPlaceholder')}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label={t('setup.tmdbKey')}
          />
          <Button type="submit" disabled={!key.trim()} loading={save.isPending && 'tmdbApiKey' in (save.variables ?? {})}>
            {t('server.verifySave')}
          </Button>
          {s.tmdb.source === 'settings' && (
            <Button variant="ghost" onClick={() => save.mutate({ tmdbApiKey: '' })}>
              {t('server.removeKey')}
            </Button>
          )}
        </form>
        {s.tmdb.source === 'environment' && <p className="text-xs text-faint">{t('server.keyPriority')}</p>}
      </section>
    </div>
  );
}
