import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { formatBytes, formatRelative, resolutionLabel } from '../../lib/format';
import { Button } from '../../components/Button';
import { ConfirmModal, Modal } from '../../components/Modal';
import { EmptyState, ErrorState, PageLoader, Spinner } from '../../components/States';
import { toast } from '../../components/Toast';

export type CleanupRule = 'unwatched' | 'stale' | 'large' | 'duplicates' | 'missingInfo';

export interface CleanupRules {
  unwatched: { enabled: boolean; days: number };
  stale: { enabled: boolean; days: number };
  large: { enabled: boolean; gb: number };
  duplicates: { enabled: boolean };
  missingInfo: { enabled: boolean };
}

export interface CleanupCandidate {
  fileId: number;
  libraryId: number;
  library: string;
  kind: 'movie' | 'episode';
  title: string;
  subtitle: string | null;
  href: string | null;
  path: string;
  size: number;
  width: number | null;
  height: number | null;
  addedAt: number;
  watchedBy: number;
  started: boolean;
  lastWatchedAt: number | null;
  reasons: { rule: CleanupRule; text: string }[];
}

export interface CleanupList {
  summary: { rules: CleanupRules; counts: Record<CleanupRule, { files: number; bytes: number }>; total: { files: number; bytes: number }; kept: number };
  deletion: { enabled: boolean; libraries: { id: number; name: string; path: string; writable: boolean }[] };
  total: number;
  bytes: number;
  items: CleanupCandidate[];
}

interface DeleteResult {
  fileId: number;
  path: string | null;
  size: number;
  ok: boolean;
  error: string | null;
}

const PAGE_SIZE = 50;
const RULE_LABELS: Record<CleanupRule, string> = {
  unwatched: 'Never watched',
  stale: 'Not watched in a long time',
  large: 'Very large files',
  duplicates: 'Extra versions',
  missingInfo: 'Unidentified or unreadable',
};
const RULE_ORDER: CleanupRule[] = ['unwatched', 'stale', 'large', 'duplicates', 'missingInfo'];

export function watchStatus(c: Pick<CleanupCandidate, 'started' | 'watchedBy' | 'lastWatchedAt'>): string {
  if (!c.started) return 'Never watched';
  const who = c.watchedBy ? `Watched by ${c.watchedBy} ${c.watchedBy === 1 ? 'user' : 'users'}` : 'Started, not finished';
  return c.lastWatchedAt ? `${who} · last ${formatRelative(c.lastWatchedAt)}` : who;
}

function RulesEditor({ rules, onClose }: { rules: CleanupRules; onClose: () => void }) {
  const qc = useQueryClient();
  const [r, setR] = useState<CleanupRules>(rules);
  const save = useMutation({
    mutationFn: () => api.put('/api/admin/cleanup/settings', { rules: r }),
    onSuccess: () => {
      toast.success('Rules saved.');
      void qc.invalidateQueries({ queryKey: ['admin', 'cleanup'] });
      onClose();
    },
    onError: (err) => toast.error(err),
  });
  const toggle = (key: CleanupRule, label: string, hint: string, extra?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <label className="flex flex-1 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={r[key].enabled} onChange={(e) => setR({ ...r, [key]: { ...r[key], enabled: e.target.checked } })} />
        <span>
          {label}
          <span className="block text-xs text-faint">{hint}</span>
        </span>
      </label>
      {extra}
    </div>
  );
  const number = (label: string, value: number, unit: string, onChange: (n: number) => void, disabled: boolean) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{label}</span>
      <input type="number" min={1} className="input w-24" value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))} />
      <span className="text-muted">{unit}</span>
    </label>
  );
  return (
    <Modal title="Clean-up rules" open onClose={onClose}>
      <p className="text-sm text-muted">Rules only suggest files. Nothing is deleted until you review the list and confirm.</p>
      <div className="mt-3 divide-y divide-line/50">
        {toggle('unwatched', 'Never watched', 'Added a while ago and not started by anyone.', number('Days since added', r.unwatched.days, 'days', (n) => setR({ ...r, unwatched: { ...r.unwatched, days: n } }), !r.unwatched.enabled))}
        {toggle('stale', 'Not watched in a long time', 'Watched before, but nobody played it since.', number('Days since last watched', r.stale.days, 'days', (n) => setR({ ...r, stale: { ...r.stale, days: n } }), !r.stale.enabled))}
        {toggle('large', 'Very large files', 'Files above a size limit.', number('Size limit in GB', r.large.gb, 'GB', (n) => setR({ ...r, large: { ...r.large, gb: n } }), !r.large.enabled))}
        {toggle('duplicates', 'Extra versions', 'Lower-quality copies of a movie or episode; the version that plays by default is never suggested.')}
        {toggle('missingInfo', 'Unidentified or unreadable', 'Titles without metadata and files FFprobe could not read.')}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} loading={save.isPending}>Save rules</Button>
      </div>
    </Modal>
  );
}

function DeleteModal({ items, onClose, onDone }: { items: CleanupCandidate[]; onClose: () => void; onDone: (results: DeleteResult[]) => void }) {
  const [understood, setUnderstood] = useState(false);
  const bytes = items.reduce((n, c) => n + c.size, 0);
  const del = useMutation({
    mutationFn: () => api.post<{ results: DeleteResult[] }>('/api/admin/cleanup/delete', { fileIds: items.map((c) => c.fileId), confirm: true }),
    onSuccess: (r) => onDone(r.results),
    onError: (err) => toast.error(err),
  });
  return (
    <Modal title={`Delete ${items.length} ${items.length === 1 ? 'file' : 'files'}?`} open onClose={onClose}>
      <p className="text-sm text-muted">
        These files are removed from disk ({formatBytes(bytes)}). This cannot be undone. Subtitle files and other files in the folders are left alone.
      </p>
      <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-raised/50 p-3 text-xs">
        {items.map((c) => (
          <li key={c.fileId} className="flex justify-between gap-3">
            <span className="min-w-0 break-all">{c.path}</span>
            <span className="shrink-0 text-muted tabular-nums">{formatBytes(c.size)}</span>
          </li>
        ))}
      </ul>
      <label className="mt-4 flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-danger)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        I understand that these files are permanently deleted.
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={!understood} loading={del.isPending} icon={<Trash2 className="size-4" />} onClick={() => del.mutate()}>
          Delete permanently
        </Button>
      </div>
    </Modal>
  );
}

function KeptFiles({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'cleanup', 'kept'], queryFn: () => api.get<{ fileId: number; path: string; size: number; decidedBy: string; decidedAt: number }[]>('/api/admin/cleanup/kept') });
  const undo = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/cleanup/kept/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'cleanup'] }),
    onError: (err) => toast.error(err),
  });
  return (
    <Modal title="Kept files" open onClose={onClose}>
      <p className="text-sm text-muted">These files are not suggested again unless they change.</p>
      {q.isLoading ? (
        <div className="grid place-items-center py-8"><Spinner className="size-5" /></div>
      ) : !q.data?.length ? (
        <p className="py-6 text-center text-sm text-muted">No kept files.</p>
      ) : (
        <ul className="mt-3 max-h-80 divide-y divide-line/50 overflow-y-auto text-sm">
          {q.data.map((k) => (
            <li key={k.fileId} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-all">{k.path}</p>
                <p className="text-xs text-faint">{formatBytes(k.size)} · kept by {k.decidedBy} {formatRelative(k.decidedAt)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => undo.mutate(k.fileId)}>Suggest again</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function CleanupPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const rule = (RULE_ORDER as string[]).includes(params.get('rule') ?? '') ? (params.get('rule') as CleanupRule) : null;
  const libraryId = params.get('library');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [selected, setSelected] = useState<Map<number, CleanupCandidate>>(new Map());
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAllow, setConfirmAllow] = useState(false);
  const [showKept, setShowKept] = useState(false);
  const q = useQuery({
    queryKey: ['admin', 'cleanup', rule, libraryId, page],
    queryFn: () => api.get<CleanupList>(`/api/admin/cleanup?page=${page}&limit=${PAGE_SIZE}${rule ? `&rule=${rule}` : ''}${libraryId ? `&libraryId=${libraryId}` : ''}`),
    placeholderData: keepPreviousData,
  });
  // A different list (filter or page change) starts with nothing selected.
  useEffect(() => setSelected(new Map()), [rule, libraryId, page]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'cleanup'] });
  const keep = useMutation({
    mutationFn: (ids: number[]) => api.post<{ kept: number }>('/api/admin/cleanup/keep', { fileIds: ids }),
    onSuccess: (r) => {
      toast.success(`${r.kept} ${r.kept === 1 ? 'file is' : 'files are'} kept and will not be suggested again.`);
      setSelected(new Map());
      refresh();
    },
    onError: (err) => toast.error(err),
  });
  const allow = useMutation({
    mutationFn: (deletion: boolean) => api.put('/api/admin/cleanup/settings', { deletion }),
    onSuccess: () => {
      setConfirmAllow(false);
      refresh();
    },
    onError: (err) => toast.error(err),
  });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { summary, deletion, items, total } = q.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const readOnly = deletion.libraries.filter((l) => !l.writable);
  const chosen = [...selected.values()];
  const chosenBytes = chosen.reduce((n, c) => n + c.size, 0);
  const allOnPage = items.length > 0 && items.every((c) => selected.has(c.fileId));
  const toggle = (c: CleanupCandidate) =>
    setSelected((s) => {
      const next = new Map(s);
      if (next.has(c.fileId)) next.delete(c.fileId);
      else next.set(c.fileId, c);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">
          Suggestions for freeing up space, from what Velyx already knows about your files and what people watched. Rules only suggest: nothing is deleted until you select files, choose Delete and confirm.
        </p>
        <div className="flex flex-wrap gap-2">
          {summary.kept > 0 && <Button variant="ghost" size="sm" onClick={() => setShowKept(true)}>Kept files ({summary.kept})</Button>}
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Rules</Button>
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${deletion.enabled ? 'border-danger/30 bg-danger/5' : 'border-line bg-raised/50'}`}>
        {deletion.enabled ? <TriangleAlert className="size-4 shrink-0 text-danger" /> : <ShieldCheck className="size-4 shrink-0 text-ok" />}
        <p className="flex-1">
          {deletion.enabled ? 'Deleting files is allowed. Deleted files are gone for good.' : 'Deleting files is off: you can review suggestions and keep files, but nothing can be deleted.'}
          {readOnly.length > 0 && <span className="block text-xs text-muted">Read-only (cannot delete): {readOnly.map((l) => l.name).join(', ')}. Mount the folder without :ro to allow it.</span>}
        </p>
        {deletion.enabled ? (
          <Button variant="secondary" size="sm" onClick={() => allow.mutate(false)} loading={allow.isPending}>Turn off</Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setConfirmAllow(true)}>Allow deleting</Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {RULE_ORDER.map((key) => {
          const c = summary.counts[key];
          const on = summary.rules[key].enabled;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={rule === key}
              onClick={() => set({ rule: rule === key ? null : key, page: null })}
              className={`rounded-xl border px-4 py-3 text-left transition ${rule === key ? 'border-accent bg-accent/10' : 'border-line/70 bg-surface hover:border-line hover:bg-raised/60'}`}
            >
              <p className="text-xs text-muted">{RULE_LABELS[key]}</p>
              <p className={`font-display text-lg font-semibold tabular-nums ${!c.files ? 'text-faint' : ''}`}>{on ? c.files.toLocaleString() : 'Off'}</p>
              {on && c.files > 0 && <p className="text-xs text-faint">{formatBytes(c.bytes)}</p>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {total.toLocaleString()} {total === 1 ? 'suggestion' : 'suggestions'} · {formatBytes(q.data.bytes)}
          {rule && <> in <span className="text-ink">{RULE_LABELS[rule]}</span></>}
        </p>
        {deletion.libraries.length > 1 && (
          <select aria-label="Library" value={libraryId ?? ''} onChange={(e) => set({ library: e.target.value || null, page: null })} className="h-9 rounded-lg border border-line bg-surface px-3 text-sm">
            <option value="">All libraries</option>
            {deletion.libraries.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Check className="size-6" />} title="Nothing to clean up">No files match the active rules.</EmptyState>
      ) : (
        <div className={`panel ${q.isFetching ? 'opacity-70' : ''}`}>
          <label className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 text-sm text-muted">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={allOnPage}
              onChange={() =>
                setSelected((s) => {
                  const next = new Map(s);
                  for (const c of items) {
                    if (allOnPage) next.delete(c.fileId);
                    else next.set(c.fileId, c);
                  }
                  return next;
                })
              }
            />
            Select all on this page
          </label>
          <ul className="divide-y divide-line/50">
            {items.map((c) => (
              <li key={c.fileId} className={`flex gap-3 px-4 py-3 ${selected.has(c.fileId) ? 'bg-accent/5' : ''}`}>
                <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" checked={selected.has(c.fileId)} onChange={() => toggle(c)} aria-label={`Select ${c.title}${c.subtitle ? ` ${c.subtitle}` : ''}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {c.href ? <Link to={c.href} className="font-medium hover:text-accent">{c.title}</Link> : <span className="font-medium">{c.title}</span>}
                    {c.subtitle && <span className="text-sm text-muted">{c.subtitle}</span>}
                    <span className="ml-auto font-display font-semibold tabular-nums">{formatBytes(c.size)}</span>
                  </div>
                  <p className="text-xs text-muted">
                    {[resolutionLabel(c.width, c.height), watchStatus(c), `added ${formatRelative(c.addedAt)}`, c.library].filter(Boolean).join(' · ')}
                  </p>
                  <p className="mt-0.5 text-xs break-all text-faint">{c.path}</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {c.reasons.map((r) => (
                      <li key={r.rule + r.text} className="rounded-full bg-raised px-2 py-0.5 text-xs text-ink/85">{r.text}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="mr-2 text-muted">Page {page} of {pages}</span>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} icon={<ChevronLeft className="size-4" />}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} icon={<ChevronRight className="size-4" />}>Next</Button>
        </div>
      )}

      {chosen.length > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-2xl backdrop-blur" role="region" aria-label="Selected files">
          <p className="flex-1 text-sm">
            <span className="font-semibold">{chosen.length}</span> selected · {formatBytes(chosenBytes)}
          </p>
          <Button variant="secondary" size="sm" onClick={() => keep.mutate(chosen.map((c) => c.fileId))} loading={keep.isPending}>Keep</Button>
          <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} disabled={!deletion.enabled} title={deletion.enabled ? undefined : 'Allow deleting first'} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>Cancel</Button>
        </div>
      )}

      {editing && <RulesEditor rules={summary.rules} onClose={() => setEditing(false)} />}
      {showKept && <KeptFiles onClose={() => setShowKept(false)} />}
      {confirmDelete && (
        <DeleteModal
          items={chosen}
          onClose={() => setConfirmDelete(false)}
          onDone={(results) => {
            const ok = results.filter((r) => r.ok);
            const failed = results.filter((r) => !r.ok);
            if (ok.length) toast.success(`Deleted ${ok.length} ${ok.length === 1 ? 'file' : 'files'} (${formatBytes(ok.reduce((n, r) => n + r.size, 0))}).`);
            for (const f of failed.slice(0, 3)) toast.error(`${f.path ?? `File ${f.fileId}`}: ${f.error}`);
            setConfirmDelete(false);
            setSelected(new Map());
            refresh();
          }}
        />
      )}
      <ConfirmModal
        open={confirmAllow}
        title="Allow deleting files?"
        confirmLabel="Allow deleting"
        danger
        loading={allow.isPending}
        onConfirm={() => allow.mutate(true)}
        onClose={() => setConfirmAllow(false)}
      >
        Administrators can then delete suggested files from disk after reviewing them. Each deletion still needs a confirmation and is recorded in the audit log. The library folders must be mounted writable (without :ro).
      </ConfirmModal>
    </div>
  );
}
