import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CheckCircle2, Download, History, Plus, ShieldCheck, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import type { BackupFile, BackupOverview, BackupVerification } from '../../lib/types';
import { Button, IconButton } from '../../components/Button';
import { ConfirmModal } from '../../components/Modal';
import { ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';

const KIND_LABEL: Record<BackupFile['kind'], string> = {
  auto: 'Scheduled',
  manual: 'Manual',
  archive: 'Full archive',
  'pre-migration': 'Before upgrade',
  'pre-restore': 'Before restore',
};

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ScheduleForm({ data }: { data: BackupOverview }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(data.schedule);
  const save = useMutation({
    mutationFn: () => api.put<BackupOverview>('/api/admin/backups/settings', form),
    onSuccess: (d) => {
      qc.setQueryData(['backups'], d);
      toast.success('Backup schedule saved.');
    },
    onError: (err) => toast.error(err),
  });
  const num = (key: 'keepDaily' | 'keepWeekly' | 'keepMonthly', label: string, max: number) => (
    <div>
      <label className="label" htmlFor={`b-${key}`}>{label}</label>
      <input id={`b-${key}`} type="number" className="input" min={key === 'keepDaily' ? 1 : 0} max={max} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} disabled={form.schedule === 'off'} />
    </div>
  );
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold">Automatic backups</h2>
      <p className="mt-1 text-sm text-muted">
        Velyx saves a copy of its database on a schedule and keeps a rotating set: the newest backup of each recent day, week and month. Backups stay in the data folder; nothing is uploaded anywhere.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label" htmlFor="b-schedule">Schedule</label>
          <select id="b-schedule" className="input" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value as BackupOverview['schedule']['schedule'] })}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="b-hour">After</label>
          <select id="b-hour" className="input" value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} disabled={form.schedule === 'off'}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </div>
        {num('keepDaily', 'Keep daily', 60)}
        {num('keepWeekly', 'Keep weekly', 52)}
        {num('keepMonthly', 'Keep monthly', 36)}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-faint">{data.nextDue ? `Next scheduled backup: ${when(data.nextDue)}` : 'Automatic backups are off.'}</p>
        <Button onClick={() => save.mutate()} loading={save.isPending}>Save schedule</Button>
      </div>
    </section>
  );
}

function VerifyResult({ result }: { result: BackupVerification }) {
  return result.ok ? (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-ok">
      <CheckCircle2 className="size-3.5" /> Verified: {result.info?.users ?? '?'} users, {result.info?.movies ?? '?'} movies, {result.info?.shows ?? '?'} shows
    </p>
  ) : (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-danger">
      <XCircle className="size-3.5 shrink-0" /> {result.errors.join(' ')}
    </p>
  );
}

export function BackupPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupOverview>('/api/admin/backups') });
  const [verified, setVerified] = useState<Record<string, BackupVerification>>({});
  const [confirm, setConfirm] = useState<null | { action: 'restore' | 'delete'; backup: BackupFile }>(null);
  const set = (d: BackupOverview) => qc.setQueryData(['backups'], d);

  const create = useMutation({
    mutationFn: () => api.post<BackupFile>('/api/admin/backups'),
    onSuccess: () => {
      toast.success('Backup created.');
      void qc.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (err) => toast.error(err),
  });
  const verify = useMutation({
    mutationFn: (name: string) => api.post<BackupVerification>(`/api/admin/backups/${encodeURIComponent(name)}/verify`),
    onSuccess: (r, name) => setVerified((v) => ({ ...v, [name]: r })),
    onError: (err) => toast.error(err),
  });
  const act = useMutation({
    mutationFn: ({ action, backup }: { action: 'restore' | 'delete'; backup: BackupFile }) =>
      action === 'restore'
        ? api.post<BackupOverview>(`/api/admin/backups/${encodeURIComponent(backup.name)}/restore`, { confirm: true })
        : api.del<BackupOverview>(`/api/admin/backups/${encodeURIComponent(backup.name)}`),
    onSuccess: (d, { action }) => {
      set(d);
      setConfirm(null);
      toast.success(action === 'restore' ? 'Restore staged. Restart Velyx to apply it.' : 'Backup deleted.');
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(err);
    },
  });
  const cancelRestore = useMutation({
    mutationFn: () => api.del<BackupOverview>('/api/admin/backups/restore/pending'),
    onSuccess: set,
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  return (
    <div className="space-y-6">
      {d.pendingRestore && (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
          <p className="flex-1">
            <strong>{d.pendingRestore.source}</strong> will be restored when Velyx restarts (requested by {d.pendingRestore.requestedBy}). Restart the container to apply it:{' '}
            <code className="rounded bg-bg/60 px-1.5 py-0.5 text-xs">docker compose restart velyx</code>
          </p>
          <Button variant="ghost" size="sm" onClick={() => cancelRestore.mutate()} loading={cancelRestore.isPending}>Cancel restore</Button>
        </div>
      )}

      <ScheduleForm key={JSON.stringify(d.schedule)} data={d} />

      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Stored backups</h2>
            <p className="mt-1 text-sm text-muted">In {d.folder}. Your media files are never part of a backup.</p>
          </div>
          <div className="flex gap-2">
            <a href="/api/admin/backup" download className="inline-flex h-10 items-center gap-2 rounded-lg bg-raised px-4 text-ink hover:bg-line">
              <Download className="size-4" /> Download current
            </a>
            <Button icon={<Plus className="size-4" />} onClick={() => create.mutate()} loading={create.isPending}>Back up now</Button>
          </div>
        </div>
        {d.backups.length === 0 ? (
          <p className="mt-5 text-sm text-muted">No backups yet.</p>
        ) : (
          <ul className="mt-5 divide-y divide-line/60 rounded-xl border border-line">
            {d.backups.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {b.kind === 'archive' ? <Archive className="size-5 shrink-0 text-muted" /> : <History className="size-5 shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {when(b.createdAt)}
                    <span className="ml-2 rounded-full bg-raised px-2 py-0.5 text-xs text-muted">{KIND_LABEL[b.kind]}</span>
                  </p>
                  <p className="truncate text-xs text-faint">
                    {b.name} · {formatBytes(b.size)}
                  </p>
                  {verified[b.name] && <VerifyResult result={verified[b.name]!} />}
                </div>
                <div className="flex items-center">
                  <IconButton label={`Verify ${b.name}`} onClick={() => verify.mutate(b.name)}>
                    <ShieldCheck className={`size-4 ${verify.isPending && verify.variables === b.name ? 'animate-pulse' : ''}`} />
                  </IconButton>
                  <a href={`/api/admin/backups/${encodeURIComponent(b.name)}/download`} download className="grid size-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink" aria-label={`Download ${b.name}`} title="Download">
                    <Download className="size-4" />
                  </a>
                  <Button variant="ghost" size="sm" onClick={() => setConfirm({ action: 'restore', backup: b })}>Restore</Button>
                  <IconButton label={`Delete ${b.name}`} className="hover:!text-danger" onClick={() => setConfirm({ action: 'delete', backup: b })}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel p-5 text-sm sm:p-6">
        <h2 className="font-display text-lg font-semibold">Command line</h2>
        <p className="mt-2 text-muted">A full archive also includes artwork cache, avatars and the cookie secret:</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-bg/70 p-3 text-xs">{`docker compose exec velyx velyx backup
docker compose exec velyx velyx backup list
docker compose exec velyx velyx backup verify
docker compose exec velyx velyx restore <backup-name>`}</pre>
        <p className="mt-3 text-muted">Velyx also keeps a copy of the database before every upgrade, and before every restore.</p>
      </section>

      <ConfirmModal
        open={Boolean(confirm)}
        title={confirm?.action === 'restore' ? 'Restore this backup?' : 'Delete this backup?'}
        confirmLabel={confirm?.action === 'restore' ? 'Stage restore' : 'Delete backup'}
        danger
        loading={act.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm)}
      >
        {confirm?.action === 'restore'
          ? `The backup from ${when(confirm.backup.createdAt)} is verified and then replaces the current database when Velyx restarts. Changes made after the backup (watch progress, users, settings) are lost; the current database is kept as a "before restore" backup.`
          : confirm && `${confirm.backup.name} will be deleted permanently.`}
      </ConfirmModal>
    </div>
  );
}
