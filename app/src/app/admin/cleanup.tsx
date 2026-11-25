import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminScreen, Card, Chips, confirmThen, Pill, SmallButton, useAdminAction } from '../../components/Admin';
import { ErrorState, Field, Loading, styles } from '../../components/ui';
import { formatBytes } from '../../lib/admin';
import {
  allSelected,
  candidateFacts,
  clampRules,
  cleanupPath,
  deleteMessage,
  deleteOutcome,
  dueText,
  EMPTY_RULE,
  MAX_OWN_RULES,
  numberInput,
  pageCount,
  ruleChipLabel,
  ruleSummary,
  ruleValid,
  hasCondition,
  toggleSelected,
  togglePage,
  totalBytes,
  visibleRules,
  withoutRule,
  withRule,
  type CleanupCandidate,
  type CleanupList,
  type CleanupRule,
  type CleanupRules,
  type DeleteResult,
  type KeptFile,
  type OwnRule,
  type PlannedDeletion,
  type RulePreview,
} from '../../lib/adminCleanup';
import { dialog } from '../../lib/dialog';
import { ago } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';

/** A switch with its label, as on Admin → Users. */
function SwitchRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.body}>{label}</Text>
        {hint ? <Text style={styles.muted}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: colors.button, false: colors.line }} thumbColor={value ? colors.accent : colors.muted} />
    </View>
  );
}

/** A number field that keeps what is typed and hands on the parsed number. */
function NumberField({ label, value, onChange, min, max, decimals, optional, editable = true }: { label: string; value: number | null; onChange: (n: number | null) => void; min: number; max: number; decimals?: boolean; optional?: boolean; editable?: boolean }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const opts = { min, max, decimals, optional };
  return (
    <Field
      label={label}
      value={text}
      editable={editable}
      keyboardType={decimals ? 'decimal-pad' : 'number-pad'}
      onChangeText={(v) => {
        setText(v);
        onChange(numberInput(v, opts));
      }}
      onEndEditing={() => {
        const n = numberInput(text, opts);
        setText(n === null ? '' : String(n));
      }}
    />
  );
}

/** The built-in rules: which are on and their limits. */
function RulesEditor({ rules, onClose }: { rules: CleanupRules; onClose: () => void }) {
  const { api, t, serverUrl } = useSession();
  const [r, setR] = useState(rules);
  const save = useAdminAction(async () => {
    await api.put('/api/admin/cleanup/settings', { rules: clampRules(r) });
    onClose();
  }, [[serverUrl, 'admin', 'cleanup']]);
  const toggle = (key: keyof CleanupRules) => (on: boolean) => setR({ ...r, [key]: { ...r[key], enabled: on } });
  return (
    <Card title={t('cleanup.rulesTitle')}>
      <Text style={styles.muted}>{t('cleanup.rulesIntro')}</Text>
      <SwitchRow label={t('cleanup.rule.unwatched')} hint={t('cleanup.hint.unwatched')} value={r.unwatched.enabled} onChange={toggle('unwatched')} />
      {r.unwatched.enabled && <NumberField label={t('cleanup.daysSinceAdded')} value={r.unwatched.days} min={1} max={3650} onChange={(n) => setR({ ...r, unwatched: { ...r.unwatched, days: n ?? 1 } })} />}
      <SwitchRow label={t('cleanup.rule.stale')} hint={t('cleanup.hint.stale')} value={r.stale.enabled} onChange={toggle('stale')} />
      {r.stale.enabled && <NumberField label={t('cleanup.daysSinceWatched')} value={r.stale.days} min={1} max={3650} onChange={(n) => setR({ ...r, stale: { ...r.stale, days: n ?? 1 } })} />}
      <SwitchRow label={t('cleanup.rule.large')} hint={t('cleanup.hint.large')} value={r.large.enabled} onChange={toggle('large')} />
      {r.large.enabled && <NumberField label={t('cleanup.sizeLimit')} value={r.large.gb} min={1} max={10_000} onChange={(n) => setR({ ...r, large: { ...r.large, gb: n ?? 1 } })} />}
      <SwitchRow label={t('cleanup.rule.duplicates')} hint={t('cleanup.hint.duplicates')} value={r.duplicates.enabled} onChange={toggle('duplicates')} />
      <SwitchRow label={t('cleanup.rule.missingInfo')} hint={t('cleanup.hint.missingInfo')} value={r.missingInfo.enabled} onChange={toggle('missingInfo')} />
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <SmallButton label={t('common.cancel')} onPress={onClose} />
        <SmallButton label={t('cleanup.saveRules')} filled busy={save.isPending} onPress={() => save.mutate(undefined)} />
      </View>
    </Card>
  );
}

/** Files an administrator chose to keep; each can be suggested again. */
function KeptFiles({ onClose }: { onClose: () => void }) {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'cleanup', 'kept'], queryFn: () => api.get<KeptFile[]>('/api/admin/cleanup/kept') });
  const undo = useAdminAction((id: number) => api.del(`/api/admin/cleanup/kept/${id}`), [[serverUrl, 'admin', 'cleanup']]);
  const now = Date.now();
  return (
    <Card title={t('cleanup.keptTitle')} right={<SmallButton label={t('common.close')} onPress={onClose} />}>
      <Text style={styles.muted}>{t('cleanup.keptIntro')}</Text>
      {q.isLoading ? (
        <Text style={styles.muted}>{t('common.loading')}</Text>
      ) : !q.data?.length ? (
        <Text style={styles.muted}>{t('cleanup.noKept')}</Text>
      ) : (
        q.data.map((k) => {
          const a = ago(k.decidedAt, now);
          return (
            <View key={k.fileId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.body}>{k.path}</Text>
                <Text style={styles.muted}>
                  {formatBytes(k.size)} · {t('cleanup.keptBy', { name: k.decidedBy, when: t(a.key, { n: a.n }) })}
                </Text>
              </View>
              <SmallButton label={t('cleanup.suggestAgain')} busy={undo.isPending && undo.variables === k.fileId} onPress={() => undo.mutate(k.fileId)} />
            </View>
          );
        })
      )}
    </Card>
  );
}

/** One own rule, new or changed, with "what does it catch". */
function OwnRuleEditor({ initial, libraries, saving, onSave, onClose }: { initial: OwnRule; libraries: { id: number; name: string }[]; saving: boolean; onSave: (r: OwnRule) => void; onClose: () => void }) {
  const { api, t } = useSession();
  const [r, setR] = useState(initial);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const check = useAdminAction(async () => setPreview(await api.post<RulePreview>('/api/admin/cleanup/rules/preview', { rule: { ...r, name: r.name.trim() || '…' } })), []);
  const change = (patch: Partial<OwnRule>) => {
    setR((x) => ({ ...x, ...patch }));
    setPreview(null);
  };
  return (
    <Card title={initial.id ? t('cleanup.own.editTitle') : t('cleanup.own.newTitle')}>
      <Field label={t('cleanup.own.name')} value={r.name} maxLength={60} placeholder={t('cleanup.own.namePlaceholder')} onChangeText={(name) => change({ name })} />
      <Text style={styles.label}>{t('cleanup.own.library')}</Text>
      <Chips
        value={r.libraryId === null ? '' : String(r.libraryId)}
        choices={[{ value: '', label: t('cleanup.own.allLibraries') }, ...libraries.map((l) => ({ value: String(l.id), label: l.name }))]}
        onChange={(v) => change({ libraryId: v ? Number(v) : null })}
      />
      <Text style={styles.label}>{t('cleanup.own.kind')}</Text>
      <Chips value={r.kind} choices={(['all', 'movie', 'episode'] as const).map((k) => ({ value: k, label: t(`cleanup.own.kind.${k}` as MessageKey) }))} onChange={(kind) => change({ kind })} />
      <Text style={styles.label}>{t('cleanup.own.watched')}</Text>
      <Chips value={r.watched} choices={(['any', 'nobody', 'someone', 'everyone'] as const).map((k) => ({ value: k, label: t(`cleanup.own.watched.${k}` as MessageKey) }))} onChange={(watched) => change({ watched })} />
      <NumberField label={`${t('cleanup.own.addedDays')} (${t('cleanup.own.optional')})`} value={r.addedDays} min={1} max={3650} optional onChange={(addedDays) => change({ addedDays })} />
      <NumberField label={`${t('cleanup.own.notPlayedDays')} (${t('cleanup.own.optional')})`} value={r.notPlayedDays} min={1} max={3650} optional onChange={(notPlayedDays) => change({ notPlayedDays })} />
      <NumberField label={`${t('cleanup.own.minGb')} (${t('cleanup.own.optional')})`} value={r.minGb} min={0.1} max={10_000} decimals optional onChange={(minGb) => change({ minGb })} />
      {!hasCondition(r) && <Text style={styles.error}>{t('cleanup.own.needCondition')}</Text>}

      <Text style={styles.label}>{t('cleanup.own.action')}</Text>
      <Chips
        value={r.action}
        choices={[
          { value: 'suggest', label: t('cleanup.own.suggest') },
          { value: 'delete', label: t('cleanup.own.delete') },
        ]}
        onChange={(action) => change({ action })}
      />
      {r.action === 'delete' && (
        <>
          <NumberField label={t('cleanup.own.graceDays')} value={r.graceDays} min={1} max={365} onChange={(n) => change({ graceDays: n ?? 1 })} />
          <Text style={styles.muted}>{t('cleanup.own.deleteHint')}</Text>
        </>
      )}
      <SwitchRow label={t('cleanup.own.enabled')} value={r.enabled} onChange={(enabled) => change({ enabled })} />

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row' }}>
          <SmallButton label={t('cleanup.own.preview')} disabled={!hasCondition(r)} busy={check.isPending} onPress={() => check.mutate(undefined)} />
        </View>
        {preview && (
          <>
            <Text style={styles.body}>{t('cleanup.own.previewResult', { n: preview.files, size: formatBytes(preview.bytes) })}</Text>
            {preview.items.map((i) => (
              <Text key={i.fileId} style={styles.muted} numberOfLines={1}>
                {i.title}
                {i.subtitle ? ` ${i.subtitle}` : ''}
              </Text>
            ))}
          </>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <SmallButton label={t('common.cancel')} onPress={onClose} />
        <SmallButton label={t('cleanup.saveRules')} filled disabled={!ruleValid(r)} busy={saving} onPress={() => onSave({ ...r, name: r.name.trim() })} />
      </View>
    </Card>
  );
}

/** Own rules and the deletions they planned. */
function OwnRules({ libraries, deletionEnabled, onKeep, keeping }: { libraries: { id: number; name: string }[]; deletionEnabled: boolean; onKeep: (ids: number[]) => void; keeping: number | null }) {
  const { api, t, serverUrl, language } = useSession();
  const qc = useQueryClient();
  const key = [serverUrl, 'admin', 'cleanup'];
  const rules = useQuery({ queryKey: [...key, 'own-rules'], queryFn: () => api.get<{ rules: OwnRule[] }>('/api/admin/cleanup/rules') });
  const planned = useQuery({ queryKey: [...key, 'planned'], queryFn: () => api.get<PlannedDeletion[]>('/api/admin/cleanup/planned') });
  const [editing, setEditing] = useState<{ index: number | null; rule: OwnRule } | null>(null);
  const list = rules.data?.rules ?? [];
  const save = useAdminAction(async (next: OwnRule[]) => {
    await api.put('/api/admin/cleanup/rules', { rules: next });
    setEditing(null);
    // The server plans in the background; ask again a moment later.
    setTimeout(() => void qc.invalidateQueries({ queryKey: [...key, 'planned'] }), 1500);
  }, [key]);
  const now = Date.now();
  return (
    <>
      <Card
        title={t('cleanup.own.title')}
        right={editing ? undefined : <SmallButton label={t('cleanup.own.add')} disabled={list.length >= MAX_OWN_RULES} onPress={() => setEditing({ index: null, rule: EMPTY_RULE })} />}
      >
        <Text style={styles.muted}>{t('cleanup.own.intro')}</Text>
        {list.length === 0 ? (
          <Text style={styles.muted}>{t('cleanup.own.none')}</Text>
        ) : (
          list.map((r, i) => (
            <View key={r.id ?? i} style={{ gap: 6 }}>
              <Text style={[styles.body, { fontWeight: '600', color: r.enabled ? colors.ink : colors.muted }]}>{r.name}</Text>
              <Text style={styles.muted}>{ruleSummary(r, t)}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <SmallButton label={t('cleanup.own.edit')} onPress={() => setEditing({ index: i, rule: r })} />
                <SmallButton label={t('cleanup.own.remove')} danger busy={save.isPending && editing === null} onPress={() => confirmThen(t('cleanup.own.removeConfirm', { name: r.name }), t('cleanup.own.remove'), t('common.cancel'), () => save.mutate(withoutRule(list, i)))} />
              </View>
            </View>
          ))
        )}
      </Card>
      {editing && <OwnRuleEditor initial={editing.rule} libraries={libraries} saving={save.isPending} onClose={() => setEditing(null)} onSave={(rule) => save.mutate(withRule(list, editing.index, rule))} />}
      {(planned.data?.length ?? 0) > 0 && (
        <Card title={t('cleanup.own.plannedTitle')}>
          <Text style={styles.muted}>{deletionEnabled ? t('cleanup.own.plannedIntro') : t('cleanup.own.plannedWaiting')}</Text>
          {planned.data!.map((p) => (
            <View key={p.fileId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.body}>
                  {p.title}
                  {p.subtitle ? ` ${p.subtitle}` : ''}
                </Text>
                <Text style={[styles.muted, { color: colors.danger }]}>
                  {[formatBytes(p.size), p.library, t('cleanup.own.byRule', { rule: p.rule }), dueText(p.dueAt, now, t, language)].join(' · ')}
                </Text>
              </View>
              <SmallButton label={t('cleanup.keep')} busy={keeping === p.fileId} onPress={() => onKeep([p.fileId])} />
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

/** One suggested file: tap to select it. */
function CandidateRow({ c, selected, onToggle }: { c: CleanupCandidate; selected: boolean; onToggle: () => void }) {
  const { t, language } = useSession();
  const now = Date.now();
  const name = `${c.title}${c.subtitle ? ` ${c.subtitle}` : ''}`;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t('cleanup.select', { name })}
      onPress={onToggle}
      style={{ backgroundColor: selected ? 'rgba(182,156,255,0.12)' : colors.surface, borderRadius: radius.lg, padding: 14, gap: 4, borderWidth: 2, borderColor: selected ? colors.accent : 'transparent' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: selected ? colors.accent : colors.muted, backgroundColor: selected ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
          {selected ? <Text style={{ color: colors.bg, fontWeight: '800', fontSize: 14, lineHeight: 16 }}>✓</Text> : null}
        </View>
        <Text style={[styles.body, { flex: 1, fontWeight: '600' }]}>
          {c.title}
          {c.subtitle ? <Text style={styles.muted}> {c.subtitle}</Text> : null}
        </Text>
        <Text style={[styles.body, { fontWeight: '700' }]}>{formatBytes(c.size)}</Text>
      </View>
      <Text style={styles.muted}>{candidateFacts(c, t, now)}</Text>
      <Text style={[styles.muted, { color: colors.faint }]}>{c.path}</Text>
      {c.versions && c.versions.length > 1 && (
        <View style={{ gap: 2, marginTop: 4, padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }}>
          <Text style={[styles.muted, { color: colors.faint }]}>{t('cleanup.versions')}</Text>
          {c.versions.map((v) => (
            <Text key={v.fileId} style={[styles.muted, v.fileId === c.fileId && { color: colors.ink }]}>
              {[v.name, v.format, formatBytes(v.size), v.keep ? t('cleanup.bestVersion') : null, v.fileId === c.fileId ? t('cleanup.thisFile') : null].filter(Boolean).join(' · ')}
            </Text>
          ))}
        </View>
      )}
      {c.plan ? <Pill text={t('cleanup.plannedBadge', { when: dueText(c.plan.dueAt, now, t, language) })} tone="danger" /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
        {c.reasons.map((r) => (
          <Pill key={r.rule + r.text} text={r.text} />
        ))}
      </View>
    </Pressable>
  );
}

/**
 * Admin → Clean-up: suggestions for freeing space from the server's rules, the rules themselves (built in
 * and own), kept files and planned deletions. Deleting needs "Allow deleting" and a confirmation that
 * names every file.
 */
export default function Cleanup() {
  const { api, t, serverUrl, language } = useSession();
  const key = [serverUrl, 'admin', 'cleanup'];
  const [rule, setRule] = useState<CleanupRule | null>(null);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, CleanupCandidate>>(new Map());
  const [panel, setPanel] = useState<'rules' | 'kept' | null>(null);
  const q = useQuery({
    queryKey: [...key, rule, libraryId, page, language],
    queryFn: () => api.get<CleanupList>(cleanupPath({ rule, libraryId, page })),
    placeholderData: keepPreviousData,
  });
  // Another list (filter or page) starts with nothing selected.
  useEffect(() => setSelected(new Map()), [rule, libraryId, page]);
  const keep = useAdminAction(async (ids: number[]) => {
    const r = await api.post<{ kept: number }>('/api/admin/cleanup/keep', { fileIds: ids });
    setSelected(new Map());
    dialog.alert('Vidalune', t('cleanup.keptDone', { n: r.kept }));
  }, [key]);
  const allow = useAdminAction((deletion: boolean) => api.put('/api/admin/cleanup/settings', { deletion }), [key]);
  const del = useAdminAction(async (ids: number[]) => {
    const r = await api.post<{ results: DeleteResult[] }>('/api/admin/cleanup/delete', { fileIds: ids, confirm: true });
    setSelected(new Map());
    dialog.alert(t('cleanup.deleteDone'), deleteOutcome(r.results, t));
  }, [key]);

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { summary, deletion, items, total } = q.data;
  const pages = pageCount(total);
  const readOnly = deletion.libraries.filter((l) => !l.writable);
  const chosen = [...selected.values()];
  const filter = (patch: () => void) => {
    patch();
    setPage(1);
  };

  const askDelete = () =>
    dialog.alert(t('cleanup.deleteTitle', { n: chosen.length }), deleteMessage(chosen, t), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('cleanup.deletePermanently'), style: 'destructive', onPress: () => del.mutate(chosen.map((c) => c.fileId)) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AdminScreen title={t('admin.cleanup')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
        <Text style={styles.muted}>{t('cleanup.intro')}</Text>

        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 10, borderWidth: 1, borderColor: deletion.enabled ? colors.danger : colors.line }}>
          <Text style={[styles.body, deletion.enabled && { color: colors.danger }]}>{deletion.enabled ? t('cleanup.deletionOn') : t('cleanup.deletionOff')}</Text>
          {readOnly.length > 0 && <Text style={styles.muted}>{t('cleanup.readOnly', { names: readOnly.map((l) => l.name).join(', ') })}</Text>}
          <View style={{ flexDirection: 'row' }}>
            {deletion.enabled ? (
              <SmallButton label={t('cleanup.turnOff')} busy={allow.isPending} onPress={() => allow.mutate(false)} />
            ) : (
              <SmallButton label={t('cleanup.allowDeleting')} danger busy={allow.isPending} onPress={() => confirmThen(`${t('cleanup.allowTitle')}\n\n${t('cleanup.allowText')}`, t('cleanup.allowDeleting'), t('common.cancel'), () => allow.mutate(true))} />
            )}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <SmallButton label={t('cleanup.rulesButton')} filled={panel === 'rules'} onPress={() => setPanel(panel === 'rules' ? null : 'rules')} />
          {summary.kept > 0 && <SmallButton label={t('cleanup.keptButton', { n: summary.kept })} filled={panel === 'kept'} onPress={() => setPanel(panel === 'kept' ? null : 'kept')} />}
        </View>
        {panel === 'rules' && <RulesEditor rules={summary.rules} onClose={() => setPanel(null)} />}
        {panel === 'kept' && <KeptFiles onClose={() => setPanel(null)} />}

        <OwnRules libraries={deletion.libraries} deletionEnabled={deletion.enabled} keeping={keep.isPending && keep.variables?.length === 1 ? keep.variables[0]! : null} onKeep={(ids) => keep.mutate(ids)} />

        <Chips<CleanupRule | ''>
          value={rule ?? ''}
          choices={[{ value: '', label: t('cleanup.allRules') }, ...visibleRules(summary).map((r) => ({ value: r, label: ruleChipLabel(summary, r, t) }))]}
          onChange={(v) => filter(() => setRule(v || null))}
        />
        {deletion.libraries.length > 1 && (
          <Chips
            value={libraryId === null ? '' : String(libraryId)}
            choices={[{ value: '', label: t('cleanup.own.allLibraries') }, ...deletion.libraries.map((l) => ({ value: String(l.id), label: l.name }))]}
            onChange={(v) => filter(() => setLibraryId(v ? Number(v) : null))}
          />
        )}
        <Text style={styles.muted}>
          {t('cleanup.suggestions', { n: total })} · {formatBytes(q.data.bytes)}
        </Text>

        {items.length === 0 ? (
          <Card title={t('cleanup.nothing')}>
            <Text style={styles.muted}>{t('cleanup.nothingText')}</Text>
          </Card>
        ) : (
          <>
            <View style={{ flexDirection: 'row' }}>
              <SmallButton label={allSelected(selected, items) ? t('cleanup.selectNone') : t('cleanup.selectAll')} onPress={() => setSelected((s) => togglePage(s, items))} />
            </View>
            <View style={{ gap: 10, opacity: q.isFetching ? 0.7 : 1 }}>
              {items.map((c) => (
                <CandidateRow key={c.fileId} c={c} selected={selected.has(c.fileId)} onToggle={() => setSelected((s) => toggleSelected(s, c))} />
              ))}
            </View>
          </>
        )}

        {pages > 1 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <Text style={[styles.muted, { marginRight: 4 }]}>{t('cleanup.pageOf', { page, pages })}</Text>
            <SmallButton label={t('cleanup.previous')} disabled={page <= 1} onPress={() => setPage(page - 1)} />
            <SmallButton label={t('cleanup.next')} disabled={page >= pages} onPress={() => setPage(page + 1)} />
          </View>
        )}
        {chosen.length > 0 && <View style={{ height: 96 }} />}
      </AdminScreen>

      {chosen.length > 0 && (
        <View accessibilityLabel={t('cleanup.selectedFiles')} style={{ position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          <Text style={styles.body}>{t('cleanup.selectedCount', { n: chosen.length, size: formatBytes(totalBytes(chosen)) })}</Text>
          {!deletion.enabled && <Text style={styles.muted}>{t('cleanup.allowFirst')}</Text>}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <SmallButton label={t('cleanup.keep')} busy={keep.isPending && (keep.variables?.length ?? 0) > 1} onPress={() => keep.mutate(chosen.map((c) => c.fileId))} />
            <SmallButton label={t('cleanup.delete')} danger disabled={!deletion.enabled} busy={del.isPending} onPress={askDelete} />
            <SmallButton label={t('common.cancel')} onPress={() => setSelected(new Map())} />
          </View>
        </View>
      )}
    </View>
  );
}
