import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { HardDrive, Pause, Play, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { formatBytes, formatClock, formatDuration, formatRelative, resolutionLabel, scheduleLabel } from '../../lib/format';
import type { ActiveStream, Dashboard, DiskInfo, ScanState, StorageReport } from '../../lib/types';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';

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

function Meter({ label, value, detail, warnAt = 90 }: { label: string; value: number | null; detail?: string; warnAt?: number }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="text-sm">
      <div className="flex justify-between gap-3">
        <span>{label}</span>
        <span className="text-muted tabular-nums">{detail ?? (value === null ? '—' : `${pct.toFixed(0)}%`)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${pct >= warnAt ? 'bg-danger' : pct >= warnAt - 15 ? 'bg-amber' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Banner when the data volume runs low; exported for tests. */
export function StorageWarning({ disk }: { disk: DiskInfo | null }) {
  if (!disk || disk.level === 'ok') return null;
  const critical = disk.level === 'critical';
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border px-5 py-4 ${critical ? 'border-danger/40 bg-danger/10' : 'border-amber/40 bg-amber/10'}`}>
      <TriangleAlert className={`mt-0.5 size-5 shrink-0 ${critical ? 'text-danger' : 'text-amber'}`} />
      <div className="text-sm">
        <p className="font-semibold">
          {critical ? 'Storage critically low' : 'Storage running low'} · {formatBytes(disk.free)} remaining
        </p>
        <p className="mt-0.5 text-ink/80">
          {critical
            ? 'Library scans and scheduled backups are paused until there is more free space on the data volume. Your media is never deleted.'
            : 'Free up space on the data volume, or clear unused cache below.'}
        </p>
      </div>
    </div>
  );
}

/** "4 s", "2m 10s" style duration for scans (formatDuration rounds to minutes). */
export function scanDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : formatDuration(s);
}

const STATUS_STYLE: Record<ScanState['status'], string> = {
  scanning: 'bg-accent/15 text-accent',
  queued: 'bg-accent/10 text-accent',
  paused: 'bg-amber/15 text-amber',
  failed: 'bg-danger/15 text-danger',
  idle: 'bg-raised text-muted',
};

function ScannerCard({ scan, probe, libraryName }: { scan: ScanState; probe: Dashboard['probeQueue']; libraryName: (id: number) => string }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api.post<ScanState>(`/api/libraries/scans/${scan.paused ? 'resume' : 'pause'}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
    onError: (err) => toast.error(err),
  });
  const run = scan.running;
  const pct = run && run.progress.total > 0 ? (run.progress.processed / run.progress.total) * 100 : null;
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Scanner</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[scan.status]}`}>{scan.status}</span>
      </div>
      {run && (
        <div className="mt-4 space-y-2">
          <Meter label={`${libraryName(run.libraryId)} — ${run.progress.phase}`} value={pct} detail={run.progress.total ? `${run.progress.processed.toLocaleString()} / ${run.progress.total.toLocaleString()} files` : 'Looking for files…'} warnAt={101} />
          {run.progress.currentFile && <p className="truncate text-xs text-faint" title={run.progress.currentFile}>{run.progress.currentFile}</p>}
        </div>
      )}
      {scan.paused && (
        <p className="mt-3 text-sm text-amber">
          {scan.paused.reason === 'low-disk' ? 'Paused automatically: disk space is critically low.' : `Paused by an administrator ${formatRelative(scan.paused.since)}.`}
        </p>
      )}
      <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
        <dt className="text-faint">Queued</dt>
        <dd>{scan.queued.length ? scan.queued.map((j) => libraryName(j.libraryId)).join(', ') : 'Nothing'}</dd>
        <dt className="text-faint">Last successful</dt>
        <dd>
          {scan.lastSuccess
            ? `${formatRelative(scan.lastSuccess.at)} · ${libraryName(scan.lastSuccess.libraryId)}${scan.lastSuccess.durationMs !== null ? ` · took ${scanDuration(scan.lastSuccess.durationMs)}` : ''}`
            : 'Never'}
        </dd>
        <dt className="text-faint">Last failed</dt>
        <dd className={scan.lastFailure?.message ? 'text-danger' : ''}>
          {scan.lastFailure ? `${formatRelative(scan.lastFailure.at)} · ${libraryName(scan.lastFailure.libraryId)}${scan.lastFailure.message ? ` — ${scan.lastFailure.message}` : ''}` : 'Never'}
        </dd>
        <dt className="text-faint">Scheduled scans</dt>
        <dd className={scan.schedule.waitingForPlayback ? 'text-amber' : ''}>{scheduleLabel(scan.schedule)}</dd>
        <dt className="text-faint">FFprobe</dt>
        <dd>{probe.active ? `${probe.active} running${probe.waiting ? `, ${probe.waiting} waiting` : ''}` : 'Idle'}</dd>
      </dl>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" size="sm" icon={scan.paused ? <Play className="size-4" /> : <Pause className="size-4" />} loading={toggle.isPending} onClick={() => toggle.mutate()}>
          {scan.paused ? 'Resume scanning' : 'Pause scanning'}
        </Button>
      </div>
    </section>
  );
}

function StreamRow({ s }: { s: ActiveStream }) {
  const watching = Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000));
  return (
    <li className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {s.title}
          {s.subtitle && <span className="font-normal text-muted"> · {s.subtitle}</span>}
        </p>
        <p className="truncate text-xs text-faint">
          {s.username}
          {s.device && ` · ${s.device}`}
          {s.positionSec !== null && s.durationSec ? ` · at ${formatClock(s.positionSec)} of ${formatClock(s.durationSec)}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
        <span className={`rounded-full px-2 py-0.5 ${s.mode === 'direct' ? 'bg-ok/15 text-ok' : 'bg-accent/15 text-accent'}`}>{s.mode === 'direct' ? 'Direct Play' : 'Remux'}</span>
        {resolutionLabel(s.width, s.height) && <span className="text-muted">{resolutionLabel(s.width, s.height)}</span>}
        {s.bitrate && <span className="text-muted tabular-nums">{(s.bitrate / 1_000_000).toFixed(1)} Mbps</span>}
        <span className="text-muted tabular-nums" title="Watching for">{formatClock(watching)}</span>
      </div>
    </li>
  );
}

function StorageCard({ dashboard }: { dashboard: Dashboard }) {
  const qc = useQueryClient();
  const report = useQuery({ queryKey: ['admin', 'storage'], queryFn: () => api.get<StorageReport>('/api/admin/storage'), staleTime: 5 * 60_000 });
  const refresh = useMutation({
    mutationFn: () => api.get<StorageReport>('/api/admin/storage?refresh=1'),
    onSuccess: (r) => qc.setQueryData(['admin', 'storage'], r),
  });
  const cleanup = useMutation({
    mutationFn: (target: 'artwork' | 'subtitles') => api.post<{ files: number; bytes: number; report: StorageReport }>('/api/admin/storage/cleanup', { target }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'storage'], r.report);
      toast.success(`Removed ${r.files.toLocaleString()} unused ${r.files === 1 ? 'file' : 'files'} (${formatBytes(r.bytes)}).`);
    },
    onError: (err) => toast.error(err),
  });
  const r = report.data;
  const disk = dashboard.disk;
  const rows: Array<[string, number | undefined]> = [
    ['Database', r?.velyx.database],
    ['Artwork cache', r?.velyx.artwork],
    ['Subtitle cache', r?.velyx.subtitles],
    ['Avatars', r?.velyx.avatars],
    ['Backups', r?.velyx.backups],
  ];
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Storage</h2>
        <button type="button" onClick={() => refresh.mutate()} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink" aria-label="Recalculate storage" title="Recalculate">
          <RefreshCw className={`size-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {disk && (
        <div className="mt-4">
          <Meter label="Data volume" value={(disk.used / disk.total) * 100} detail={`${formatBytes(disk.used)} used · ${formatBytes(disk.free)} free of ${formatBytes(disk.total)}`} />
        </div>
      )}
      <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="tabular-nums">{v === undefined ? '…' : formatBytes(v)}</dd>
          </div>
        ))}
        <dt className="text-faint">Media indexed</dt>
        <dd>{formatBytes(dashboard.storage.mediaBytes)} in {dashboard.counts.files.toLocaleString()} files</dd>
      </dl>
      {r && (
        <div className="mt-4 space-y-2">
          {(['artwork', 'subtitles'] as const).map((kind) => {
            const c = r.cache[kind];
            return (
              <div key={kind} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised/50 px-3 py-2 text-sm">
                <span>
                  {kind === 'artwork' ? 'Unused artwork' : 'Unused subtitles'}: <span className="text-muted">{c.unusedFiles.toLocaleString()} files, {formatBytes(c.unusedBytes)}</span>
                </span>
                <Button variant="ghost" size="sm" disabled={c.unusedFiles === 0} loading={cleanup.isPending && cleanup.variables === kind} onClick={() => cleanup.mutate(kind)}>
                  Clear
                </Button>
              </div>
            );
          })}
          <p className="text-xs text-faint">Only cache files that nothing in the library uses any more are removed. Media files are never touched.</p>
        </div>
      )}
      <div className="mt-5 space-y-3">
        {dashboard.storage.libraries.map((l) =>
          l.disk ? (
            <Meter key={l.id} label={l.name} value={((l.disk.total - l.disk.free) / l.disk.total) * 100} detail={`${formatBytes(l.disk.free)} free of ${formatBytes(l.disk.total)}`} />
          ) : (
            <p key={l.id} className="flex items-center gap-2 text-sm text-danger">
              <HardDrive className="size-4" /> {l.name}: folder not available
            </p>
          ),
        )}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const q = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.get<Dashboard>('/api/admin/dashboard'),
    // Poll faster only while something is happening.
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.scan.running || d.scan.queued.length || d.streams.length) ? 10_000 : 30_000;
    },
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const libraryName = (id: number) => d.storage.libraries.find((l) => l.id === id)?.name ?? `Library ${id}`;
  const memUsed = d.memory.systemTotal - d.memory.systemFree;
  return (
    <div className="space-y-8">
      <StorageWarning disk={d.disk} />
      {d.update.available && d.update.url && (
        <a href={d.update.url} target="_blank" rel="noreferrer" className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-5 py-3 text-sm hover:bg-accent/15">
          <strong>Velyx {d.update.latest} is available</strong>
          <span className="text-ink/80">You have {d.update.current}. See what's new, then update with docker compose pull &amp;&amp; docker compose up -d.</span>
        </a>
      )}
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
          <h2 className="font-display text-lg font-semibold">Server</h2>
          <div className="mt-4 space-y-3">
            <Meter label="CPU (system)" value={d.cpu.system} />
            <Meter label="CPU (Velyx)" value={d.cpu.velyx} />
            <Meter label="Memory" value={(memUsed / d.memory.systemTotal) * 100} detail={`${formatBytes(memUsed)} of ${formatBytes(d.memory.systemTotal)} · Velyx ${formatBytes(d.memory.rss)}`} />
          </div>
          <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-faint">Velyx</dt>
            <dd>v{d.version} · up {formatDuration(d.uptimeSec)}</dd>
            <dt className="text-faint">TMDB</dt>
            <dd className={d.tmdb.configured ? 'text-ok' : 'text-amber'}>{d.tmdb.configured ? `Configured (${d.tmdb.source === 'environment' ? 'environment variable' : 'settings'})` : 'Not configured'}</dd>
        <dt className="text-faint">FFprobe</dt>
            <dd className={d.ffprobe ? '' : 'text-danger'}>{d.ffprobe ? d.ffprobe.split(' Copyright')[0] : 'Not found — media analysis is disabled'}</dd>
            <dt className="text-faint">CPU</dt>
            <dd>
              {d.cpus} {d.cpus === 1 ? 'core' : 'cores'}, load {d.loadAverage.map((l) => l.toFixed(2)).join(' / ')}
            </dd>
            <dt className="text-faint">Last backup</dt>
            <dd>
              <Link to="/admin/backup" className="hover:text-accent">
                {d.backups.latest ? formatRelative(d.backups.latest.createdAt) : 'None yet'}
                {d.backups.nextDue ? (d.backups.nextDue <= Date.now() + 60_000 ? ' · next one due now' : ` · next ${new Date(d.backups.nextDue).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`) : ''}
              </Link>
            </dd>
            <dt className="text-faint">Runtime</dt>
            <dd className="break-all">Node {d.node} on {d.platform}</dd>
          </dl>
        </section>

        <ScannerCard scan={d.scan} probe={d.probeQueue} libraryName={libraryName} />

        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">Active streams</h2>
            <span className="text-sm text-muted">{d.streams.length || 'None'}</span>
          </div>
          {d.streams.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nobody is watching right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line/50">
              {d.streams.map((s) => (
                <StreamRow key={s.id} s={s} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-faint">Direct Play sends files as they are. Remux repackages the file and converts audio when needed; Velyx never transcodes video.</p>
        </section>

        <StorageCard dashboard={d} />
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
