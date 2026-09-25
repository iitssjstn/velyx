import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CircleAlert, Film, FolderPlus, Pencil, RefreshCw, ScanSearch, Trash2, Tv } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import type { Library, ScanState } from '../../lib/types';
import { Button, IconButton } from '../../components/Button';
import { ConfirmModal, Modal } from '../../components/Modal';
import { EmptyState, ErrorState, PageLoader, Spinner } from '../../components/States';
import { toast } from '../../components/Toast';

const PHASES: Record<string, string> = {
  discovering: 'Looking for files',
  analyzing: 'Analyzing files',
  cleaning: 'Cleaning up',
  metadata: 'Fetching metadata',
  done: 'Finishing',
};

function LibraryForm({ initial, mediaRoots, onDone }: { initial?: Library; mediaRoots: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<'movies' | 'shows'>(initial?.type ?? 'movies');
  const [path, setPath] = useState(initial?.path ?? (mediaRoots[0] ? `${mediaRoots[0].replace(/\/$/, '')}/` : ''));
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => (initial ? api.put(`/api/libraries/${initial.id}`, { name: name.trim(), path: path.trim() }) : api.post('/api/libraries', { name: name.trim(), type, path: path.trim() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['libraries'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      toast.success(initial ? 'Library updated.' : 'Library added. Scanning started.');
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
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Library type">
          {(
            [
              ['movies', 'Movies', Film],
              ['shows', 'TV Shows', Tv],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              onClick={() => {
                setType(value);
                if (!name || name === 'Movies' || name === 'TV Shows') setName(label);
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
        <label className="label" htmlFor="lname">Name</label>
        <input id="lname" className="input" required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'movies' ? 'Movies' : 'TV Shows'} />
      </div>
      <div>
        <label className="label" htmlFor="lpath">Folder</label>
        <input id="lpath" className="input font-mono text-sm" required value={path} onChange={(e) => setPath(e.target.value)} placeholder="/media/movies" spellCheck={false} />
        <p className="mt-1.5 text-xs text-faint">
          The path inside the container. Must be inside {mediaRoots.join(', ')}. With the default docker-compose setup use <code>/media/movies</code> or <code>/media/tv</code>.
        </p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={m.isPending}>{initial ? 'Save' : 'Add library'}</Button>
      </div>
    </form>
  );
}

function IssuesModal({ library, onClose }: { library: Library; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['libraries', library.id, 'issues'],
    queryFn: () => api.get<{ unrecognized: { id: number; path: string }[]; failed: { id: number; path: string; error: string | null }[] }>(`/api/libraries/${library.id}/issues`),
  });
  const rel = (p: string) => (p.startsWith(library.path) ? p.slice(library.path.length + 1) : p);
  return (
    <Modal title={`Scan issues: ${library.name}`} open onClose={onClose} wide>
      {q.isLoading ? (
        <div className="grid h-32 place-items-center"><Spinner className="size-6" /></div>
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data && q.data.unrecognized.length + q.data.failed.length === 0 ? (
        <p className="text-muted">No problems found in the last scan.</p>
      ) : (
        <div className="space-y-6 text-sm">
          {q.data!.failed.length > 0 && (
            <div>
              <h3 className="font-medium">Could not be analyzed ({q.data!.failed.length})</h3>
              <p className="text-xs text-faint">FFprobe could not read these files. They may be damaged or still copying.</p>
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
              <h3 className="font-medium">Not recognized ({q.data!.unrecognized.length})</h3>
              <p className="text-xs text-faint">Velyx could not find a season/episode number. Rename them like “Show Name S01E02.mkv” or “1x02”.</p>
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
    refetchInterval: (query) => (query.state.data?.libraries.some((l) => l.scanning || l.queued) ? 1500 : false),
  });
  // Light poll of the queue so scans started elsewhere (schedule, other admins) show up.
  useQuery({
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
      toast.success('Scan queued.');
    },
    onError: (err) => toast.error(err),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/libraries/${id}`),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries();
      toast.success('Library removed. Your files were not touched.');
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
          <p className="font-medium">Your server is ready.</p>
          <p className="mt-1 text-sm text-muted">Add your movie and TV folders to start building the library. Scanning runs in the background.</p>
          <button type="button" className="mt-2 text-sm text-accent" onClick={() => setParams({}, { replace: true })}>Dismiss</button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Media folders Velyx watches. Files are only read, never modified.</p>
        <div className="flex gap-2">
          {libraries.length > 0 && (
            <Button variant="secondary" icon={<ScanSearch className="size-4" />} onClick={() => action.mutate({ url: '/api/libraries/scan-all' })}>
              Scan all
            </Button>
          )}
          <Button icon={<FolderPlus className="size-4" />} onClick={() => setAdding(true)}>Add library</Button>
        </div>
      </div>

      {libraries.length === 0 ? (
        <EmptyState icon={<FolderPlus className="size-6" />} title="No libraries yet" action={<Button onClick={() => setAdding(true)}>Add your first library</Button>}>
          Create a Movies library for {`${mediaRoots[0] ?? '/media'}/movies`} and a TV Shows library for {`${mediaRoots[0] ?? '/media'}/tv`}.
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
                      {l.itemCount.toLocaleString()} {l.type === 'movies' ? 'movies' : 'shows'}, {l.fileCount.toLocaleString()} files
                      {!l.available && <span className="ml-2 text-danger">Folder not available — check the volume mount</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton label="Scan for new files" disabled={Boolean(l.scanning) || l.queued} onClick={() => action.mutate({ url: `/api/libraries/${l.id}/scan` })}>
                      <ScanSearch className="size-4" />
                    </IconButton>
                    <IconButton label="Refresh all metadata" disabled={Boolean(l.scanning) || l.queued} onClick={() => action.mutate({ url: `/api/libraries/${l.id}/scan`, body: { refreshMetadata: true } })}>
                      <RefreshCw className="size-4" />
                    </IconButton>
                    <IconButton label="Scan issues" onClick={() => setIssues(l)}>
                      <CircleAlert className="size-4" />
                    </IconButton>
                    <IconButton label="Edit" onClick={() => setEditing(l)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label="Remove" onClick={() => setDeleting(l)} className="hover:!text-danger">
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-3 border-t border-line/50 pt-3 text-sm">
                  {l.scanning ? (
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-accent">
                          <Spinner className="size-4" /> {PHASES[l.scanning.phase] ?? 'Scanning'}
                        </span>
                        {l.scanning.total > 0 && <span className="text-muted tabular-nums">{l.scanning.processed}/{l.scanning.total}</span>}
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full bg-accent transition-all" style={{ width: `${pct ?? 5}%` }} />
                      </div>
                    </div>
                  ) : l.queued ? (
                    <span className="text-muted">Waiting for another scan to finish…</span>
                  ) : l.lastScanStatus === 'error' ? (
                    <span className="text-danger">Last scan failed {formatRelative(l.lastScanAt)}: {l.lastScanMessage}</span>
                  ) : (
                    <span className="text-muted">
                      Last scanned {formatRelative(l.lastScanAt)}
                      {l.lastScanMessage && `: ${l.lastScanMessage}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal title="Add library" open={adding} onClose={() => setAdding(false)}>
        {adding && <LibraryForm mediaRoots={mediaRoots} onDone={() => setAdding(false)} />}
      </Modal>
      <Modal title="Edit library" open={Boolean(editing)} onClose={() => setEditing(null)}>
        {editing && <LibraryForm initial={editing} mediaRoots={mediaRoots} onDone={() => setEditing(null)} />}
      </Modal>
      {issues && <IssuesModal library={issues} onClose={() => setIssues(null)} />}
      <ConfirmModal
        open={Boolean(deleting)}
        title="Remove library?"
        confirmLabel="Remove library"
        danger
        loading={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      >
        “{deleting?.name}” and its watch history will be removed from Velyx. The files on disk are not deleted.
      </ConfirmModal>
    </div>
  );
}
