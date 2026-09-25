import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ServerSettings } from '../../lib/types';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';

/** Server name/URL and TMDB configuration. The TMDB key is write-only: the API never returns it. */
export function ServerSettingsPanel() {
  const qc = useQueryClient();
  const { refetchServer } = useAuth();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<ServerSettings>('/api/admin/settings') });
  const [form, setForm] = useState({ serverName: '', serverUrl: '', tmdbLanguage: '', includeAdult: false, watchFolders: true });
  const [key, setKey] = useState('');

  useEffect(() => {
    if (q.data) setForm({ serverName: q.data.serverName, serverUrl: q.data.serverUrl, tmdbLanguage: q.data.tmdbLanguage, includeAdult: q.data.includeAdult, watchFolders: q.data.watchFolders });
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
    save.mutate({ ...form, serverName: form.serverName.trim(), serverUrl: form.serverUrl.trim(), tmdbLanguage: form.tmdbLanguage.trim() });
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
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={form.watchFolders} onChange={(e) => setForm({ ...form, watchFolders: e.target.checked })} />
            <span>
              Update libraries automatically when files change
              <span className="block text-xs text-faint">New movies and episodes (for example from Radarr or Sonarr) appear about 30 seconds after they are added. Scheduled scans keep running as a fallback.</span>
            </span>
          </label>
        </div>
        <dl className="grid gap-3 border-t border-line/60 pt-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-faint">Version</dt>
            <dd>Velyx {s.version}</dd>
          </div>
          <div>
            <dt className="text-faint">Media roots (MEDIA_ROOTS)</dt>
            <dd className="font-mono text-xs">{s.mediaRoots.join(', ')}</dd>
          </div>
          <div>
            <dt className="text-faint">Automatic scans</dt>
            <dd>{s.scanIntervalMinutes > 0 ? `Every ${s.scanIntervalMinutes} minutes` : 'Disabled'}</dd>
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
