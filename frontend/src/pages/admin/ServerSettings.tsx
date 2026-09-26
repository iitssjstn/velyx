import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ServerSettings } from '../../lib/types';
import { intervalLabel } from '../../lib/format';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';

/** Server name/URL and TMDB configuration. The TMDB key is write-only: the API never returns it. */
export function ServerSettingsPanel() {
  const qc = useQueryClient();
  const { refetchServer } = useAuth();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<ServerSettings>('/api/admin/settings') });
  const [form, setForm] = useState({ serverName: '', serverUrl: '', tmdbLanguage: '', includeAdult: false, watchFolders: true, updateCheck: true, scanOnStartup: false, deferScansWhilePlaying: true });
  // '' = use SCAN_INTERVAL_MINUTES from the environment
  const [interval, setScanInterval] = useState('');
  const [key, setKey] = useState('');

  useEffect(() => {
    if (!q.data) return;
    setForm({ serverName: q.data.serverName, serverUrl: q.data.serverUrl, tmdbLanguage: q.data.tmdbLanguage, includeAdult: q.data.includeAdult, watchFolders: q.data.watchFolders, updateCheck: q.data.updateCheck, scanOnStartup: q.data.scanOnStartup, deferScansWhilePlaying: q.data.deferScansWhilePlaying });
    setScanInterval(q.data.scanIntervalSource === 'settings' ? String(q.data.scanIntervalMinutes) : '');
  }, [q.data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<ServerSettings>('/api/admin/settings', body),
    onSuccess: (data, body) => {
      qc.setQueryData(['admin', 'settings'], data);
      refetchServer();
      if ('tmdbApiKey' in body) {
        setKey('');
        toast.success(body.tmdbApiKey ? 'TMDB key verified and saved. Metadata is being fetched.' : 'TMDB key removed.');
      } else toast.success('Settings saved.');
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
        <h2 className="font-display text-lg font-semibold">Server</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sname">Server name</label>
            <input id="sname" className="input" required maxLength={64} value={form.serverName} onChange={(e) => setForm({ ...form, serverName: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="surl">Server URL</label>
            <input id="surl" className="input" placeholder="https://velyx.example.com" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} />
            <p className="mt-1 text-xs text-faint">Optional. The address you share with others.</p>
          </div>
          <div>
            <label className="label" htmlFor="lang">Metadata language</label>
            <input id="lang" className="input" placeholder="en-US" value={form.tmdbLanguage} onChange={(e) => setForm({ ...form, tmdbLanguage: e.target.value })} />
            <p className="mt-1 text-xs text-faint">TMDB language code, e.g. en-US or nl-NL. Refresh metadata to apply it to existing items.</p>
          </div>
          <label className="flex items-center gap-3 self-center text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={form.includeAdult} onChange={(e) => setForm({ ...form, includeAdult: e.target.checked })} />
            Include adult titles in TMDB searches
          </label>
          <label className="flex items-start gap-3 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.updateCheck} onChange={(e) => setForm({ ...form, updateCheck: e.target.checked })} />
            <span>
              Tell me when a new Velyx version is available
              <span className="block text-xs text-faint">Checks the project's version tags on GitHub at most once a day, when an administrator opens the dashboard. Nothing about this server is sent.</span>
            </span>
          </label>
        </div>
        <fieldset className="space-y-4 border-t border-line/60 pt-5">
          <legend className="sr-only">Scanning</legend>
          <h3 className="font-display text-base font-semibold">Scanning</h3>
          <p className="text-sm text-muted">Scans only analyse new and changed files, one at a time by default (SCAN_CONCURRENCY), so they stay light on old hardware.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="interval">Scheduled scans</label>
              <select id="interval" className="input" value={interval} onChange={(e) => setScanInterval(e.target.value)}>
                <option value="">Default: {intervalLabel(s.scanIntervalDefault).toLowerCase()} (SCAN_INTERVAL_MINUTES)</option>
                {[0, 60, 180, 360, 720, 1440].map((m) => (
                  <option key={m} value={m}>{intervalLabel(m)}</option>
                ))}
                {interval !== '' && ![0, 60, 180, 360, 720, 1440].includes(Number(interval)) && <option value={interval}>{intervalLabel(Number(interval))}</option>}
              </select>
              <p className="mt-1 text-xs text-faint">A safety net: folder watching below usually picks up new files within a minute.</p>
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.watchFolders} onChange={(e) => setForm({ ...form, watchFolders: e.target.checked })} />
            <span>
              Scan automatically when files are added or removed
              <span className="block text-xs text-faint">New movies and episodes (for example from Radarr or Sonarr) appear about 30 seconds after they are added.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.scanOnStartup} onChange={(e) => setForm({ ...form, scanOnStartup: e.target.checked })} />
            <span>
              Scan when Velyx starts
              <span className="block text-xs text-faint">Picks up files added while the server was off, a minute after start-up.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.deferScansWhilePlaying} onChange={(e) => setForm({ ...form, deferScansWhilePlaying: e.target.checked })} />
            <span>
              Hold scheduled scans while someone is watching
              <span className="block text-xs text-faint">The scan starts when playback ends (at most a few hours later). Any scan that is running also slows down while someone watches.</span>
            </span>
          </label>
        </fieldset>
        <dl className="grid gap-3 border-t border-line/60 pt-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-faint">Version</dt>
            <dd>Velyx {s.version}</dd>
          </div>
          <div>
            <dt className="text-faint">Media roots (MEDIA_ROOTS)</dt>
            <dd className="font-mono text-xs">{s.mediaRoots.join(', ')}</dd>
          </div>
        </dl>
        <Button type="submit" loading={save.isPending && !('tmdbApiKey' in (save.variables ?? {}))}>Save</Button>
      </form>

      <section className="panel space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">TMDB metadata</h2>
          <p className="mt-1 text-sm text-muted">
            Posters, descriptions, cast and episode titles come from The Movie Database. The key stays on the server and is never sent to browsers.
          </p>
        </div>
        <p className="text-sm">
          Status:{' '}
          {s.tmdb.configured ? (
            <span className="text-ok">
              configured {s.tmdb.hint && <span className="font-mono">{s.tmdb.hint}</span>} ({s.tmdb.source === 'environment' ? 'from TMDB_API_KEY' : 'saved in settings'})
            </span>
          ) : (
            <span className="text-amber">not configured — Velyx uses file names only</span>
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
            placeholder={s.tmdb.configured ? 'Enter a new key to replace it' : 'TMDB v3 API key or v4 read access token'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="TMDB API key"
          />
          <Button type="submit" disabled={!key.trim()} loading={save.isPending && 'tmdbApiKey' in (save.variables ?? {})}>
            Verify &amp; save
          </Button>
          {s.tmdb.source === 'settings' && (
            <Button variant="ghost" onClick={() => save.mutate({ tmdbApiKey: '' })}>
              Remove saved key
            </Button>
          )}
        </form>
        {s.tmdb.source === 'environment' && <p className="text-xs text-faint">A key saved here takes priority over the TMDB_API_KEY environment variable.</p>}
      </section>
    </div>
  );
}
