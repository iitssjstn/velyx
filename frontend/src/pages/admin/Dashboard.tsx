import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { HardDrive, Pause, Play, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { formatBytes, formatDuration, formatRelative, scheduleLabel } from '../../lib/format';
import type { Dashboard, DiskInfo, ScanState, StorageReport } from '../../lib/types';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';
import { StreamRow } from '../../components/ActiveStreams';
import { toast } from '../../components/Toast';
import { intlLocale, t, useT } from '../../i18n';

function Stat({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const body = (
    <>
      <p className="font-display text-3xl font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString(intlLocale()) : value}</p>
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
  const { t } = useT();
  if (!disk || disk.level === 'ok') return null;
  const critical = disk.level === 'critical';
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border px-5 py-4 ${critical ? 'border-danger/40 bg-danger/10' : 'border-amber/40 bg-amber/10'}`}>
      <TriangleAlert className={`mt-0.5 size-5 shrink-0 ${critical ? 'text-danger' : 'text-amber'}`} />
      <div className="text-sm">
        <p className="font-semibold">
          {t(critical ? 'dashboard.storageCritical' : 'dashboard.storageLow', { free: formatBytes(disk.free) })}
        </p>
        <p className="mt-0.5 text-ink/80">
          {critical
            ? t('dashboard.storageCriticalText')
            : t('dashboard.storageLowText')}
        </p>
      </div>
    </div>
  );
}

/** "4 s", "2m 10s" style duration for scans (formatDuration rounds to minutes). */
export function scanDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? t('time.seconds', { n: s }) : formatDuration(s);
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
  const { t } = useT();
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
        <h2 className="font-display text-lg font-semibold">{t('dashboard.scanner')}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[scan.status]}`}>{t(`dashboard.scanStatus.${scan.status}`)}</span>
      </div>
      {run && (
        <div className="mt-4 space-y-2">
          <Meter label={`${libraryName(run.libraryId)} — ${t(`dashboard.phase.${run.progress.phase}`)}`} value={pct} detail={run.progress.total ? t('dashboard.filesProgress', { done: run.progress.processed.toLocaleString(intlLocale()), total: run.progress.total.toLocaleString(intlLocale()) }) : t('dashboard.lookingForFiles')} warnAt={101} />
          {run.progress.currentFile && <p className="truncate text-xs text-faint" title={run.progress.currentFile}>{run.progress.currentFile}</p>}
        </div>
      )}
      {scan.paused && (
        <p className="mt-3 text-sm text-amber">
          {scan.paused.reason === 'low-disk' ? t('dashboard.pausedLowDisk') : t('dashboard.pausedByAdmin', { when: formatRelative(scan.paused.since) })}
        </p>
      )}
      <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
        <dt className="text-faint">{t('dashboard.queued')}</dt>
        <dd>{scan.queued.length ? scan.queued.map((j) => libraryName(j.libraryId)).join(', ') : t('dashboard.nothing')}</dd>
        <dt className="text-faint">{t('dashboard.lastSuccessful')}</dt>
        <dd>
          {scan.lastSuccess
            ? `${formatRelative(scan.lastSuccess.at)} · ${libraryName(scan.lastSuccess.libraryId)}${scan.lastSuccess.durationMs !== null ? ` · ${t('dashboard.took', { time: scanDuration(scan.lastSuccess.durationMs) })}` : ''}`
            : t('dashboard.never')}
        </dd>
        <dt className="text-faint">{t('dashboard.lastFailed')}</dt>
        <dd className={scan.lastFailure?.message ? 'text-danger' : ''}>
          {scan.lastFailure ? `${formatRelative(scan.lastFailure.at)} · ${libraryName(scan.lastFailure.libraryId)}${scan.lastFailure.message ? ` — ${scan.lastFailure.message}` : ''}` : t('dashboard.never')}
        </dd>
        <dt className="text-faint">{t('dashboard.scheduledScans')}</dt>
        <dd className={scan.schedule.waitingForPlayback ? 'text-amber' : ''}>{scheduleLabel(scan.schedule)}</dd>
        <dt className="text-faint">FFprobe</dt>
        <dd>{probe.active ? (probe.waiting ? t('dashboard.probeRunningWaiting', { running: probe.active, waiting: probe.waiting }) : t('dashboard.probeRunning', { running: probe.active })) : t('dashboard.idle')}</dd>
      </dl>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" size="sm" icon={scan.paused ? <Play className="size-4" /> : <Pause className="size-4" />} loading={toggle.isPending} onClick={() => toggle.mutate()}>
          {scan.paused ? t('dashboard.resumeScanning') : t('dashboard.pauseScanning')}
        </Button>
      </div>
    </section>
  );
}

function StorageCard({ dashboard }: { dashboard: Dashboard }) {
  const qc = useQueryClient();
  const { t } = useT();
  const report = useQuery({ queryKey: ['admin', 'storage'], queryFn: () => api.get<StorageReport>('/api/admin/storage'), staleTime: 5 * 60_000 });
  const refresh = useMutation({
    mutationFn: () => api.get<StorageReport>('/api/admin/storage?refresh=1'),
    onSuccess: (r) => qc.setQueryData(['admin', 'storage'], r),
  });
  const cleanup = useMutation({
    mutationFn: (target: 'artwork' | 'subtitles') => api.post<{ files: number; bytes: number; report: StorageReport }>('/api/admin/storage/cleanup', { target }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'storage'], r.report);
      toast.success(t('dashboard.removedFiles', { count: r.files, size: formatBytes(r.bytes) }));
    },
    onError: (err) => toast.error(err),
  });
  const r = report.data;
  const disk = dashboard.disk;
  const rows: Array<[string, number | undefined]> = [
    [t('dashboard.database'), r?.velyx.database],
    [t('dashboard.artworkCache'), r?.velyx.artwork],
    [t('dashboard.subtitleCache'), r?.velyx.subtitles],
    [t('dashboard.avatars'), r?.velyx.avatars],
    [t('dashboard.backups'), r?.velyx.backups],
  ];
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{t('dashboard.storage')}</h2>
        <button type="button" onClick={() => refresh.mutate()} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink" aria-label={t('dashboard.recalculateStorage')} title={t('dashboard.recalculate')}>
          <RefreshCw className={`size-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {disk && (
        <div className="mt-4">
          <Meter label={t('dashboard.dataVolume')} value={(disk.used / disk.total) * 100} detail={t('dashboard.usedFreeOf', { used: formatBytes(disk.used), free: formatBytes(disk.free), total: formatBytes(disk.total) })} />
        </div>
      )}
      <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="tabular-nums">{v === undefined ? '…' : formatBytes(v)}</dd>
          </div>
        ))}
        <dt className="text-faint">{t('dashboard.mediaIndexed')}</dt>
        <dd>{t('dashboard.bytesInFiles', { size: formatBytes(dashboard.storage.mediaBytes), count: dashboard.counts.files })}</dd>
      </dl>
      {r && (
        <div className="mt-4 space-y-2">
          {(['artwork', 'subtitles'] as const).map((kind) => {
            const c = r.cache[kind];
            return (
              <div key={kind} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised/50 px-3 py-2 text-sm">
                <span>
                  {kind === 'artwork' ? t('dashboard.unusedArtwork') : t('dashboard.unusedSubtitles')}: <span className="text-muted">{t('dashboard.filesSize', { count: c.unusedFiles, size: formatBytes(c.unusedBytes) })}</span>
                </span>
                <Button variant="ghost" size="sm" disabled={c.unusedFiles === 0} loading={cleanup.isPending && cleanup.variables === kind} onClick={() => cleanup.mutate(kind)}>
                  {t('dashboard.clear')}
                </Button>
              </div>
            );
          })}
          <p className="text-xs text-faint">{t('dashboard.cacheNote')}</p>
        </div>
      )}
      <div className="mt-5 space-y-3">
        {dashboard.storage.libraries.map((l) =>
          l.disk ? (
            <Meter key={l.id} label={l.name} value={((l.disk.total - l.disk.free) / l.disk.total) * 100} detail={t('dashboard.freeOf', { free: formatBytes(l.disk.free), total: formatBytes(l.disk.total) })} />
          ) : (
            <p key={l.id} className="flex items-center gap-2 text-sm text-danger">
              <HardDrive className="size-4" /> {t('dashboard.folderUnavailable', { name: l.name })}
            </p>
          ),
        )}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const { t, tRich } = useT();
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
  const libraryName = (id: number) => d.storage.libraries.find((l) => l.id === id)?.name ?? t('dashboard.libraryN', { n: id });
  const memUsed = d.memory.systemTotal - d.memory.systemFree;
  return (
    <div className="space-y-8">
      <StorageWarning disk={d.disk} />
      {d.update.available && d.update.url && (
        <a href={d.update.url} target="_blank" rel="noreferrer" className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-5 py-3 text-sm hover:bg-accent/15">
          <strong>{t('dashboard.updateAvailable', { version: d.update.latest ?? '' })}</strong>
          <span className="text-ink/80">{t('dashboard.updateText', { current: d.update.current })}</span>
        </a>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('nav.movies')} value={d.counts.movies} href="/movies" />
        <Stat label={t('nav.tvShows')} value={d.counts.shows} href="/shows" />
        <Stat label={t('series.episodes')} value={d.counts.episodes} />
        <Stat label={t('admin.tabs.users')} value={d.counts.users} href="/admin/users" />
      </div>

      {d.counts.needsReview > 0 && (
        <Link to="/admin/metadata" className="block rounded-xl border border-amber/30 bg-amber/10 px-5 py-4 text-amber hover:bg-amber/15">
          {t('dashboard.needsReview', { count: d.counts.needsReview })}
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-display text-lg font-semibold">{t('settings.server.title')}</h2>
          <div className="mt-4 space-y-3">
            <Meter label={t('dashboard.cpuSystem')} value={d.cpu.system} />
            <Meter label={t('dashboard.cpuVelyx')} value={d.cpu.velyx} />
            <Meter label={t('dashboard.memory')} value={(memUsed / d.memory.systemTotal) * 100} detail={t('dashboard.memoryDetail', { used: formatBytes(memUsed), total: formatBytes(d.memory.systemTotal), velyx: formatBytes(d.memory.rss) })} />
          </div>
          <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-faint">Velyx</dt>
            <dd>{t('dashboard.versionUptime', { version: d.version, uptime: formatDuration(d.uptimeSec) })}</dd>
            <dt className="text-faint">TMDB</dt>
            <dd className={d.tmdb.configured ? 'text-ok' : 'text-amber'}>{d.tmdb.configured ? (d.tmdb.source === 'environment' ? t('dashboard.tmdbEnv') : t('dashboard.tmdbSettings')) : t('dashboard.notConfigured')}</dd>
        <dt className="text-faint">FFprobe</dt>
            <dd className={d.ffprobe ? '' : 'text-danger'}>{d.ffprobe ? d.ffprobe.split(' Copyright')[0] : t('dashboard.ffprobeMissing')}</dd>
            <dt className="text-faint">CPU</dt>
            <dd>
              {t('dashboard.cores', { count: d.cpus, load: d.loadAverage.map((l) => l.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })).join(' / ') })}
            </dd>
            <dt className="text-faint">{t('dashboard.lastBackup')}</dt>
            <dd>
              <Link to="/admin/backup" className="hover:text-accent">
                {d.backups.latest ? formatRelative(d.backups.latest.createdAt) : t('dashboard.noneYet')}
                {d.backups.nextDue ? (d.backups.nextDue <= Date.now() + 60_000 ? ` · ${t('dashboard.nextDueNow')}` : ` · ${t('dashboard.nextAt', { when: new Date(d.backups.nextDue).toLocaleString(intlLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}`) : ''}
              </Link>
            </dd>
            <dt className="text-faint">{t('dashboard.runtime')}</dt>
            <dd className="break-all">{t('dashboard.nodeOn', { node: d.node, platform: d.platform })}</dd>
          </dl>
        </section>

        <ScannerCard scan={d.scan} probe={d.probeQueue} libraryName={libraryName} />

        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">{t('dashboard.activeStreams')}</h2>
            <span className="text-sm text-muted">{d.streams.length || t('dashboard.none')}</span>
          </div>
          {d.streams.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('dashboard.nobodyWatching')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line/50">
              {d.streams.map((s) => (
                <StreamRow key={s.id} s={s} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-faint">
            {tRich('dashboard.streamsNote', { link: <Link to="/admin/activity" className="underline underline-offset-4 hover:text-ink">{t('admin.tabs.activity')}</Link> })}
          </p>
        </section>

        <StorageCard dashboard={d} />
      </div>

      {d.duplicates.length > 0 && (
        <section className="panel p-5">
          <h2 className="font-display text-lg font-semibold">{t('dashboard.multipleFiles')}</h2>
          <p className="mt-1 text-sm text-muted">{t('dashboard.multipleFilesText')}</p>
          <ul className="mt-4 divide-y divide-line/50 text-sm">
            {d.duplicates.map((m) => (
              <li key={m.id} className="flex justify-between py-2">
                <Link to={`/movies/${m.id}`} className="hover:text-accent">
                  {m.title} {m.year && <span className="text-muted">({m.year})</span>}
                </Link>
                <span className="text-muted">{t('dashboard.fileCount', { count: m.files })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
