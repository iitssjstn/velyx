import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CircleAlert, FileSearch, Film, FolderPlus, Pencil, RefreshCw, ScanSearch, Trash2, Tv } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative, scheduleLabel } from '../../lib/format';
import type { Library, ScanState } from '../../lib/types';
import { Button, IconButton } from '../../components/Button';
import { ConfirmModal, Modal } from '../../components/Modal';
import { EmptyState, ErrorState, PageLoader, Spinner } from '../../components/States';
import { toast } from '../../components/Toast';
import { t, useT, type MessageKey } from '../../i18n';

const PHASES: Record<string, MessageKey> = {
  discovering: 'libraries.phases.discovering',
  analyzing: 'libraries.phases.analyzing',
  cleaning: 'libraries.phases.cleaning',
  metadata: 'libraries.phases.metadata',
  done: 'libraries.phases.done',
};

const SUMMARY: Record<string, MessageKey> = {
  files: 'libraries.summary.files',
  added: 'libraries.summary.added',
  removed: 'libraries.summary.removed',
  'need review': 'libraries.summary.needReview',
  'not recognized': 'libraries.summary.notRecognized',
  failed: 'libraries.summary.failed',
};

/** The stored scan summary ("120 files, 3 added, 0 removed") in the interface language. */
export function scanSummary(message: string): string {
  return message
    .split(', ')
    .map((part) => {
      const m = /^(\d+) (.+)$/.exec(part);
      return m && SUMMARY[m[2]] ? t(SUMMARY[m[2]], { count: Number(m[1]) }) : part;
    })
    .join(', ');
}

function LibraryForm({ initial, mediaRoots, onDone }: { initial?: Library; mediaRoots: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const { t, tRich } = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<'movies' | 'shows'>(initial?.type ?? 'movies');
  const [path, setPath] = useState(initial?.path ?? (mediaRoots[0] ? `${mediaRoots[0].replace(/\/$/, '')}/` : ''));
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => (initial ? api.put(`/api/libraries/${initial.id}`, { name: name.trim(), path: path.trim() }) : api.post('/api/libraries', { name: name.trim(), type, path: path.trim() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['libraries'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      toast.success(initial ? t('libraries.updated') : t('libraries.added'));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    m.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {!initial && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('libraries.type')}>
          {(
            [
              ['movies', t('nav.movies'), Film],
              ['shows', t('nav.tvShows'), Tv],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              onClick={() => {
                setType(value);
                if (!name || name === t('nav.movies') || name === t('nav.tvShows')) setName(label);
              }}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${type === value ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'}`}
            >
              <Icon className={`size-5 ${type === value ? 'text-accent' : 'text-muted'}`} />
              {label}
            </button>
          ))}
        </div>
      )}
      <div>
        <label className="label" htmlFor="lname">{t('common.name')}</label>
        <input id="lname" className="input" required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'movies' ? t('nav.movies') : t('nav.tvShows')} />
      </div>
      <div>
        <label className="label" htmlFor="lpath">{t('libraries.folder')}</label>
        <input id="lpath" className="input font-mono text-sm" required value={path} onChange={(e) => setPath(e.target.value)} placeholder="/media/movies" spellCheck={false} />
        <p className="mt-1.5 text-xs text-faint">
          {tRich('libraries.folderHint', { roots: mediaRoots.join(', '), movies: <code>/media/movies</code>, tv: <code>/media/tv</code> })}
        </p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" loading={m.isPending}>{initial ? t('common.save') : t('libraries.add')}</Button>
      </div>
    </form>
  );
}

function IssuesModal({ library, onClose }: { library: Library; onClose: () => void }) {
  const { t } = useT();
  const q = useQuery({
    queryKey: ['libraries', library.id, 'issues'],
    queryFn: () => api.get<{ unrecognized: { id: number; path: string }[]; failed: { id: number; path: string; error: string | null }[] }>(`/api/libraries/${library.id}/issues`),
  });
  const rel = (p: string) => (p.startsWith(library.path) ? p.slice(library.path.length + 1) : p);
  return (
    <Modal title={t('libraries.issuesTitle', { name: library.name })} open onClose={onClose} wide>
      {q.isLoading ? (
        <div className="grid h-32 place-items-center"><Spinner className="size-6" /></div>
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data && q.data.unrecognized.length + q.data.failed.length === 0 ? (
        <p className="text-muted">{t('libraries.noProblems')}</p>
      ) : (
        <div className="space-y-6 text-sm">
          {q.data!.failed.length > 0 && (
            <div>
              <h3 className="font-medium">{t('libraries.couldNotAnalyze', { count: q.data!.failed.length })}</h3>
              <p className="text-xs text-faint">{t('libraries.couldNotAnalyzeText')}</p>
              <ul className="mt-2 space-y-2">
                {q.data!.failed.map((f) => (
                  <li key={f.id} className="rounded-lg bg-bg/60 p-2">
                    <p className="font-mono text-xs break-all">{rel(f.path)}</p>
                    {f.error && <p className="mt-1 text-xs text-danger">{f.error}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {q.data!.unrecognized.length > 0 && (
            <div>
              <h3 className="font-medium">{t('libraries.notRecognized', { count: q.data!.unrecognized.length })}</h3>
              <p className="text-xs text-faint">{t('libraries.notRecognizedText')}</p>
              <ul className="mt-2 space-y-1">
                {q.data!.unrecognized.map((f) => (
                  <li key={f.id} className="font-mono text-xs break-all text-muted">{rel(f.path)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function LibrariesPanel() {
  const qc = useQueryClient();
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const welcome = params.get('welcome') === '1';
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Library | null>(null);
  const [deleting, setDeleting] = useState<Library | null>(null);
  const [issues, setIssues] = useState<Library | null>(null);

  const q = useQuery({
    queryKey: ['libraries'],
    queryFn: () => api.get<{ libraries: Library[]; mediaRoots: string[] }>('/api/libraries'),
    // Poll while something is scanning so progress stays live.
    refetchInterval: (query) => (query.state.data?.libraries.some((l) => l.scanning || l.queued) ? 5000 : false),
  });
  // Light poll of the queue so scans started elsewhere (schedule, other admins) show up.
  const status = useQuery({
    queryKey: ['scan-status'],
    queryFn: async () => {
      const s = await api.get<ScanState>('/api/libraries/scan-status');
      const known = q.data?.libraries.some((l) => l.scanning || l.queued);
      if ((s.running || s.queued.length) && !known) void qc.invalidateQueries({ queryKey: ['libraries'] });
      return s;
    },
    refetchInterval: 10_000,
  });

  const action = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => api.post(url, body ?? {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['libraries'] });
      toast.success(t('libraries.scanQueued'));
    },
    onError: (err) => toast.error(err),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/libraries/${id}`),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries();
      toast.success(t('libraries.removed'));
    },
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { libraries, mediaRoots } = q.data;

  return (
    <div className="space-y-6">
      {welcome && (
        <div className="rounded-xl border border-accent/30 bg-accent/10 px-5 py-4">
          <p className="font-medium">{t('libraries.ready')}</p>
          <p className="mt-1 text-sm text-muted">{t('libraries.readyText')}</p>
          <button type="button" className="mt-2 text-sm text-accent" onClick={() => setParams({}, { replace: true })}>{t('common.dismiss')}</button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">
          <p>{t('libraries.intro')}</p>
          {status.data && <p className="mt-0.5 text-xs text-faint">{t('libraries.scheduled', { schedule: scheduleLabel(status.data.schedule) })}</p>}
        </div>
        <div className="flex gap-2">
          {libraries.length > 0 && (
            <Button variant="secondary" icon={<ScanSearch className="size-4" />} onClick={() => action.mutate({ url: '/api/libraries/scan-all' })}>
              {t('libraries.scanAll')}
            </Button>
          )}
          <Button icon={<FolderPlus className="size-4" />} onClick={() => setAdding(true)}>{t('libraries.add')}</Button>
        </div>
      </div>

      {libraries.length === 0 ? (
        <EmptyState icon={<FolderPlus className="size-6" />} title={t('home.noLibraries')} action={<Button onClick={() => setAdding(true)}>{t('libraries.addFirst')}</Button>}>
          {t('libraries.emptyText', { movies: `${mediaRoots[0] ?? '/media'}/movies`, tv: `${mediaRoots[0] ?? '/media'}/tv` })}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {libraries.map((l) => {
            const Icon = l.type === 'movies' ? Film : Tv;
            const pct = l.scanning && l.scanning.total > 0 ? Math.round((l.scanning.processed / l.scanning.total) * 100) : null;
            return (
              <li key={l.id} className="panel p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-raised text-accent">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.name}</p>
                    <p className="truncate font-mono text-xs text-faint">{l.path}</p>
                    <p className="mt-1.5 text-sm text-muted">
                      {t(l.type === 'movies' ? 'browse.movieCount' : 'browse.showCount', { count: l.itemCount })}, {t('dashboard.fileCount', { count: l.fileCount })}
                      {!l.available && <span className="ml-2 text-danger">{t('libraries.unavailable')}</span>}
                      {l.available && l.watching && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-xs text-ok">{t('libraries.autoUpdating')}</span>}
                      {l.available && l.watchError && <span className="ml-2 text-xs text-amber" title={l.watchError}>{t('libraries.autoUpdateUnavailable', { error: l.watchError })}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton label={t('libraries.scanNew')} disabled={Boolean(l.scanning) || l.queued} onClick={() => action.mutate({ url: `/api/libraries/${l.id}/scan` })}>
                      <ScanSearch className="size-4" />
                    </IconButton>
                    <IconButton label={t('libraries.refreshMetadata')} disabled={Boolean(l.scanning) || l.queued} onClick={() => action.mutate({ url: `/api/libraries/${l.id}/scan`, body: { refreshMetadata: true } })}>
                      <RefreshCw className="size-4" />
                    </IconButton>
                    <IconButton label={t('libraries.reanalyse')} disabled={Boolean(l.scanning) || l.queued} onClick={() => action.mutate({ url: `/api/libraries/${l.id}/scan`, body: { full: true } })}>
                      <FileSearch className="size-4" />
                    </IconButton>
                    <IconButton label={t('libraries.scanIssues')} onClick={() => setIssues(l)}>
                      <CircleAlert className="size-4" />
                    </IconButton>
                    <IconButton label={t('common.edit')} onClick={() => setEditing(l)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label={t('common.remove')} onClick={() => setDeleting(l)} className="hover:!text-danger">
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-3 border-t border-line/50 pt-3 text-sm">
                  {l.scanning ? (
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-accent">
                          <Spinner className="size-4" /> {PHASES[l.scanning.phase] ? t(PHASES[l.scanning.phase]) : t('dashboard.scanStatus.scanning')}
                        </span>
                        {l.scanning.total > 0 && <span className="text-muted tabular-nums">{l.scanning.processed}/{l.scanning.total}</span>}
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full bg-accent transition-all" style={{ width: `${pct ?? 5}%` }} />
                      </div>
                    </div>
                  ) : l.queued ? (
                    <span className="text-muted">{t('libraries.waiting')}</span>
                  ) : l.lastScanStatus === 'error' ? (
                    <span className="text-danger">{t('libraries.lastFailed', { when: formatRelative(l.lastScanAt), message: l.lastScanMessage ?? '' })}</span>
                  ) : (
                    <span className="text-muted">
                      {t('libraries.lastScanned', { when: formatRelative(l.lastScanAt) })}
                      {l.lastScanMessage && `: ${scanSummary(l.lastScanMessage)}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal title={t('libraries.add')} open={adding} onClose={() => setAdding(false)}>
        {adding && <LibraryForm mediaRoots={mediaRoots} onDone={() => setAdding(false)} />}
      </Modal>
      <Modal title={t('libraries.edit')} open={Boolean(editing)} onClose={() => setEditing(null)}>
        {editing && <LibraryForm initial={editing} mediaRoots={mediaRoots} onDone={() => setEditing(null)} />}
      </Modal>
      {issues && <IssuesModal library={issues} onClose={() => setIssues(null)} />}
      <ConfirmModal
        open={Boolean(deleting)}
        title={t('libraries.removeTitle')}
        confirmLabel={t('libraries.remove')}
        danger
        loading={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      >
        {t('libraries.removeText', { name: deleting?.name ?? '' })}
      </ConfirmModal>
    </div>
  );
}
