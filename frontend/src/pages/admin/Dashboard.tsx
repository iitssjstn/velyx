import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatBytes, formatDuration, formatRelative } from '../../lib/format';
import type { Dashboard } from '../../lib/types';
import { ErrorState, PageLoader } from '../../components/States';

function Stat({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const body = (
    <>
      <p className="font-display text-3xl font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </>
  );
  return href ? (
    <Link to={href} className="panel block p-5 transition hover:border-accent/50">{body}</Link>
  ) : (
    <div className="panel p-5">{body}</div>
  );
}

function Bar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${pct > 90 ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DashboardPage() {
  const q = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api.get<Dashboard>('/api/admin/dashboard'), refetchInterval: 15_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const running = d.scan.running;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Movies" value={d.counts.movies} href="/movies" />
        <Stat label="TV shows" value={d.counts.shows} href="/shows" />
        <Stat label="Episodes" value={d.counts.episodes} />
        <Stat label="Users" value={d.counts.users} href="/admin/users" />
      </div>

      {d.counts.needsReview > 0 && (
        <Link to="/admin/metadata" className="block rounded-xl border border-amber/30 bg-amber/10 px-5 py-4 text-amber hover:bg-amber/15">
          {d.counts.needsReview} {d.counts.needsReview === 1 ? 'item needs' : 'items need'} a metadata review.
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-display text-lg font-semibold">Server status</h2>
          <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-faint">Velyx</dt>
            <dd>v{d.version}</dd>
            <dt className="text-faint">Uptime</dt>
            <dd>{formatDuration(d.uptimeSec)}</dd>
            <dt className="text-faint">Scans</dt>
            <dd>{running ? `Running (${running.progress.phase} ${running.progress.processed}/${running.progress.total})` : d.scan.queued.length ? `${d.scan.queued.length} queued` : `Idle, last ${formatRelative(d.lastScanAt)}`}</dd>
            <dt className="text-faint">TMDB</dt>
            <dd className={d.tmdb.configured ? 'text-ok' : 'text-amber'}>{d.tmdb.configured ? `Configured (${d.tmdb.source === 'environment' ? 'environment variable' : 'settings'})` : 'Not configured'}</dd>
            <dt className="text-faint">FFprobe</dt>
            <dd className={d.ffprobe ? '' : 'text-danger'}>{d.ffprobe ? d.ffprobe.split(' Copyright')[0] : 'Not found — media analysis is disabled'}</dd>
            <dt className="text-faint">Audio conversions</dt>
            <dd>{d.activeStreams === 0 ? 'None running' : `${d.activeStreams} running`}</dd>
            <dt className="text-faint">Memory (Velyx)</dt>
            <dd>{formatBytes(d.memory.rss)}</dd>
            <dt className="text-faint">System memory</dt>
            <dd>
              {formatBytes(d.memory.systemTotal - d.memory.systemFree)} of {formatBytes(d.memory.systemTotal)} used
            </dd>
            <dt className="text-faint">CPU</dt>
            <dd>
              {d.cpus} {d.cpus === 1 ? 'core' : 'cores'}, load {d.loadAverage.map((l) => l.toFixed(2)).join(' / ')}
            </dd>
            <dt className="text-faint">Runtime</dt>
            <dd className="break-all">Node {d.node} on {d.platform}</dd>
          </dl>
        </section>

        <section className="panel p-5">
          <h2 className="font-display text-lg font-semibold">Storage</h2>
          <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-faint">Media indexed</dt>
            <dd>{formatBytes(d.storage.mediaBytes)} in {d.counts.files.toLocaleString()} files</dd>
            <dt className="text-faint">Database</dt>
            <dd>{formatBytes(d.storage.databaseBytes)}</dd>
            <dt className="text-faint">Artwork cache</dt>
            <dd>{formatBytes(d.storage.cacheBytes)}</dd>
          </dl>
          <div className="mt-5 space-y-4">
            {d.storage.dataDisk && (
              <div className="text-sm">
                <div className="flex justify-between">
                  <span>Data volume</span>
                  <span className="text-muted">{formatBytes(d.storage.dataDisk.free)} free</span>
                </div>
                <Bar used={d.storage.dataDisk.total - d.storage.dataDisk.free} total={d.storage.dataDisk.total} />
              </div>
            )}
            {d.storage.libraries.map((l) =>
              l.disk ? (
                <div key={l.id} className="text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="truncate">{l.name}</span>
                    <span className="shrink-0 text-muted">{formatBytes(l.disk.free)} free of {formatBytes(l.disk.total)}</span>
                  </div>
                  <Bar used={l.disk.total - l.disk.free} total={l.disk.total} />
                </div>
              ) : (
                <p key={l.id} className="text-sm text-danger">{l.name}: folder not available</p>
              ),
            )}
          </div>
        </section>
      </div>

      {d.duplicates.length > 0 && (
        <section className="panel p-5">
          <h2 className="font-display text-lg font-semibold">Movies with multiple files</h2>
          <p className="mt-1 text-sm text-muted">These are kept as versions of one movie; the highest resolution plays by default.</p>
          <ul className="mt-4 divide-y divide-line/50 text-sm">
            {d.duplicates.map((m) => (
              <li key={m.id} className="flex justify-between py-2">
                <Link to={`/movies/${m.id}`} className="hover:text-accent">
                  {m.title} {m.year && <span className="text-muted">({m.year})</span>}
                </Link>
                <span className="text-muted">{m.files} files</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
