import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';
import { Button } from '../../components/Button';
import { ConfirmModal, Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

/** An administrator's own clean-up rule (see the server's CustomCleanupRule). */
export interface OwnRule {
  id?: string;
  name: string;
  enabled: boolean;
  libraryId: number | null;
  kind: 'all' | 'movie' | 'episode';
  watched: 'any' | 'nobody' | 'someone' | 'everyone';
  addedDays: number | null;
  notPlayedDays: number | null;
  minGb: number | null;
  action: 'suggest' | 'delete';
  graceDays: number;
}

export interface PlannedDeletion {
  fileId: number;
  title: string;
  subtitle: string | null;
  library: string;
  size: number;
  rule: string;
  dueAt: number;
}

const EMPTY: OwnRule = { name: '', enabled: true, libraryId: null, kind: 'all', watched: 'everyone', addedDays: 30, notPlayedDays: null, minGb: null, action: 'suggest', graceDays: 7 };

export function hasCondition(r: Pick<OwnRule, 'watched' | 'addedDays' | 'notPlayedDays' | 'minGb'>): boolean {
  return r.watched !== 'any' || r.addedDays !== null || r.notPlayedDays !== null || r.minGb !== null;
}

/** "watched by everyone · added 30+ days ago · deletes after 7 days" */
export function useRuleSummary() {
  const { t } = useT();
  return (r: OwnRule) =>
    [
      r.watched !== 'any' ? t(`cleanup.own.summary.watched.${r.watched}`) : null,
      r.addedDays !== null ? t('cleanup.own.summary.added', { days: r.addedDays }) : null,
      r.notPlayedDays !== null ? t('cleanup.own.summary.notPlayed', { days: r.notPlayedDays }) : null,
      r.minGb !== null ? t('cleanup.own.summary.larger', { gb: r.minGb }) : null,
      r.enabled ? (r.action === 'delete' ? t('cleanup.own.deletesAfter', { days: r.graceDays }) : t('cleanup.own.suggestOnly')) : t('cleanup.own.off'),
    ]
      .filter(Boolean)
      .join(' · ');
}

function RuleEditor({ initial, libraries, onSave, onClose, saving }: { initial: OwnRule; libraries: { id: number; name: string }[]; onSave: (r: OwnRule) => void; onClose: () => void; saving: boolean }) {
  const { t } = useT();
  const [r, setR] = useState<OwnRule>(initial);
  const [preview, setPreview] = useState<{ files: number; bytes: number; items: { fileId: number; title: string; subtitle: string | null }[] } | null>(null);
  const check = useMutation({
    mutationFn: () => api.post<typeof preview>('/api/admin/cleanup/rules/preview', { rule: { ...r, name: r.name || '…' } }),
    onSuccess: (p) => setPreview(p),
    onError: (err) => toast.error(err),
  });
  const change = (patch: Partial<OwnRule>) => {
    setR((x) => ({ ...x, ...patch }));
    setPreview(null);
  };
  /** A number field that may be left empty (no condition). */
  const optional = (label: string, value: number | null, onChange: (n: number | null) => void, step = 1) => (
    <label className="block text-sm">
      <span className="text-muted">{label} <span className="text-faint">({t('cleanup.own.optional')})</span></span>
      <input
        type="number"
        min={step}
        step={step}
        className="input mt-1 w-full"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Math.max(step, Number(e.target.value) || step))}
      />
    </label>
  );
  const valid = r.name.trim().length > 0 && hasCondition(r);
  return (
    <Modal title={initial.id ? t('cleanup.own.editTitle') : t('cleanup.own.newTitle')} open onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="text-muted">{t('cleanup.own.name')}</span>
          <input className="input mt-1 w-full" value={r.name} maxLength={60} placeholder={t('cleanup.own.namePlaceholder')} onChange={(e) => change({ name: e.target.value })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">{t('cleanup.own.library')}</span>
            <select className="input mt-1 w-full" value={r.libraryId ?? ''} onChange={(e) => change({ libraryId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('cleanup.own.allLibraries')}</option>
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">{t('cleanup.own.kind')}</span>
            <select className="input mt-1 w-full" value={r.kind} onChange={(e) => change({ kind: e.target.value as OwnRule['kind'] })}>
              {(['all', 'movie', 'episode'] as const).map((k) => (
                <option key={k} value={k}>{t(`cleanup.own.kinds.${k}`)}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-muted">{t('cleanup.own.watched')}</span>
          <select className="input mt-1 w-full" value={r.watched} onChange={(e) => change({ watched: e.target.value as OwnRule['watched'] })}>
            {(['any', 'nobody', 'someone', 'everyone'] as const).map((k) => (
              <option key={k} value={k}>{t(`cleanup.own.watchedOptions.${k}`)}</option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {optional(t('cleanup.own.addedDays'), r.addedDays, (n) => change({ addedDays: n }))}
          {optional(t('cleanup.own.notPlayedDays'), r.notPlayedDays, (n) => change({ notPlayedDays: n }))}
          {optional(t('cleanup.own.minGb'), r.minGb, (n) => change({ minGb: n }), 0.1)}
        </div>
        {!hasCondition(r) && <p className="text-sm text-danger" role="alert">{t('cleanup.own.needCondition')}</p>}

        <fieldset className="space-y-2 text-sm">
          <legend className="text-muted">{t('cleanup.own.action')}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="action" checked={r.action === 'suggest'} onChange={() => change({ action: 'suggest' })} className="accent-[var(--color-accent)]" />
            {t('cleanup.own.suggest')}
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="action" checked={r.action === 'delete'} onChange={() => change({ action: 'delete' })} className="accent-[var(--color-danger)]" />
            {t('cleanup.own.delete', { days: r.graceDays })}
            <input
              type="number"
              min={1}
              max={365}
              aria-label={t('cleanup.own.graceDays')}
              className="input w-20"
              value={r.graceDays}
              disabled={r.action !== 'delete'}
              onChange={(e) => change({ graceDays: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </label>
          {r.action === 'delete' && <p className="text-xs text-faint">{t('cleanup.own.deleteHint')}</p>}
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={r.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
          {t('cleanup.own.enabled')}
        </label>

        <div className="rounded-lg border border-line/70 bg-bg/40 p-3 text-sm">
          <Button variant="secondary" size="sm" disabled={!hasCondition(r)} loading={check.isPending} onClick={() => check.mutate()}>{t('cleanup.own.preview')}</Button>
          {preview && (
            <div className="mt-2">
              <p>{t('cleanup.own.previewResult', { count: preview.files, size: formatBytes(preview.bytes) })}</p>
              {preview.items.length > 0 && (
                <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-muted">
                  {preview.items.map((i) => (
                    <li key={i.fileId}>{i.title}{i.subtitle ? ` ${i.subtitle}` : ''}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button disabled={!valid} loading={saving} onClick={() => onSave({ ...r, name: r.name.trim() })}>{t('cleanup.saveRules')}</Button>
      </div>
    </Modal>
  );
}

/** The administrator's own rules and the deletions they planned, on the clean-up page. */
export function OwnRules({ libraries, deletionEnabled, onKeep }: { libraries: { id: number; name: string }[]; deletionEnabled: boolean; onKeep: (fileIds: number[]) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const summary = useRuleSummary();
  const rules = useQuery({ queryKey: ['admin', 'cleanup', 'own-rules'], queryFn: () => api.get<{ rules: OwnRule[] }>('/api/admin/cleanup/rules') });
  const planned = useQuery({ queryKey: ['admin', 'cleanup', 'planned'], queryFn: () => api.get<PlannedDeletion[]>('/api/admin/cleanup/planned') });
  const [editing, setEditing] = useState<{ index: number | null; rule: OwnRule } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const list = rules.data?.rules ?? [];
  const save = useMutation({
    mutationFn: (next: OwnRule[]) => api.put<{ rules: OwnRule[] }>('/api/admin/cleanup/rules', { rules: next }),
    onSuccess: () => {
      toast.success(t('cleanup.own.saved'));
      setEditing(null);
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'cleanup'] });
      // Plans follow a moment later (the server runs the rules in the background).
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['admin', 'cleanup', 'planned'] }), 1500);
    },
    onError: (err) => toast.error(err),
  });

  return (
    <section className="panel space-y-3 p-4" aria-labelledby="own-rules">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="own-rules" className="font-display text-lg font-semibold">{t('cleanup.own.title')}</h2>
          <p className="text-sm text-muted">{t('cleanup.own.intro')}</p>
        </div>
        <Button size="sm" icon={<Plus className="size-4" />} disabled={list.length >= 20} onClick={() => setEditing({ index: null, rule: EMPTY })}>{t('cleanup.own.add')}</Button>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-faint">{t('cleanup.own.none')}</p>
      ) : (
        <ul className="divide-y divide-line/50 rounded-lg border border-line/60">
          {list.map((r, i) => (
            <li key={r.id ?? i} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${r.enabled ? '' : 'text-muted'}`}>{r.name}</p>
                <p className="text-xs text-muted">{summary(r)}</p>
              </div>
              <Button variant="ghost" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing({ index: i, rule: r })}>{t('cleanup.own.edit')}</Button>
              <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setRemoving(i)}>{t('cleanup.own.remove')}</Button>
            </li>
          ))}
        </ul>
      )}

      {(planned.data?.length ?? 0) > 0 && (
        <div className="space-y-2 pt-2">
          <h3 className="flex items-center gap-2 font-medium"><CalendarClock className="size-4 text-danger" />{t('cleanup.own.plannedTitle')}</h3>
          <p className="text-xs text-muted">{deletionEnabled ? t('cleanup.own.plannedIntro') : t('cleanup.own.plannedWaiting')}</p>
          <ul className="divide-y divide-line/50 rounded-lg border border-danger/30 bg-danger/5">
            {planned.data!.map((p) => (
              <li key={p.fileId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p>{p.title}{p.subtitle ? <span className="text-muted"> {p.subtitle}</span> : null}</p>
                  <p className="text-xs text-muted">
                    {[formatBytes(p.size), p.library, t('cleanup.own.byRule', { rule: p.rule }), p.dueAt <= Date.now() ? t('cleanup.own.overdue') : t('cleanup.own.due', { date: formatDate(p.dueAt) ?? '' })].join(' · ')}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => onKeep([p.fileId])}>{t('cleanup.keep')}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <RuleEditor
          initial={editing.rule}
          libraries={libraries}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(rule) => save.mutate(editing.index === null ? [...list, rule] : list.map((x, i) => (i === editing.index ? rule : x)))}
        />
      )}
      <ConfirmModal
        open={removing !== null}
        title={t('cleanup.own.remove')}
        confirmLabel={t('cleanup.own.remove')}
        danger
        loading={save.isPending}
        onConfirm={() => save.mutate(list.filter((_, i) => i !== removing))}
        onClose={() => setRemoving(null)}
      >
        {removing !== null ? t('cleanup.own.removeConfirm', { name: list[removing]?.name ?? '' }) : null}
      </ConfirmModal>
    </section>
  );
}
