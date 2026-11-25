import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminScreen, Card, Chips, confirmThen, Pill, SmallButton, useAdminAction } from '../../components/Admin';
import { ErrorState, Field, Loading, styles } from '../../components/ui';
import { formatBytes } from '../../lib/admin';
import { backupKindKey, backupWhen, hourLabel, KEEP_LIMITS, numberInput, verifyLine, type BackupFile, type BackupOverview, type BackupSchedule, type BackupVerification } from '../../lib/adminCleanup';
import { dialog } from '../../lib/dialog';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Automatic backups: how often, after which hour, and how many to keep. */
function ScheduleCard({ data, onSaved }: { data: BackupOverview; onSaved: (d: BackupOverview) => void }) {
  const { api, t, language } = useSession();
  const [form, setForm] = useState<BackupSchedule>(data.schedule);
  const [texts, setTexts] = useState({ keepDaily: String(data.schedule.keepDaily), keepWeekly: String(data.schedule.keepWeekly), keepMonthly: String(data.schedule.keepMonthly) });
  const save = useAdminAction(async () => {
    onSaved(await api.put<BackupOverview>('/api/admin/backups/settings', form));
    dialog.alert('Vidalune', t('backup.scheduleSaved'));
  }, []);
  const off = form.schedule === 'off';
  const keep = (key: keyof typeof KEEP_LIMITS, label: string) => (
    <Field
      label={label}
      value={texts[key]}
      editable={!off}
      keyboardType="number-pad"
      onChangeText={(v) => {
        setTexts({ ...texts, [key]: v });
        setForm({ ...form, [key]: numberInput(v, KEEP_LIMITS[key]) ?? KEEP_LIMITS[key].min });
      }}
      onEndEditing={() => setTexts({ ...texts, [key]: String(form[key]) })}
    />
  );
  return (
    <Card title={t('backup.automatic')}>
      <Text style={styles.muted}>{t('backup.automaticText')}</Text>
      <Text style={styles.label}>{t('backup.schedule')}</Text>
      <Chips
        value={form.schedule}
        choices={[
          { value: 'daily', label: t('backup.daily') },
          { value: 'weekly', label: t('backup.weekly') },
          { value: 'off', label: t('backup.off') },
        ]}
        onChange={(schedule) => setForm({ ...form, schedule })}
      />
      {!off && (
        <>
          <Text style={styles.label}>{t('backup.after')}</Text>
          <Chips value={String(form.hour)} choices={HOURS.map((h) => ({ value: String(h), label: hourLabel(h) }))} onChange={(v) => setForm({ ...form, hour: Number(v) })} />
        </>
      )}
      {keep('keepDaily', t('backup.keepDaily'))}
      {keep('keepWeekly', t('backup.keepWeekly'))}
      {keep('keepMonthly', t('backup.keepMonthly'))}
      <Text style={[styles.muted, { color: colors.faint }]}>{data.nextDue ? t('backup.nextScheduled', { when: backupWhen(data.nextDue, language) }) : t('backup.automaticOff')}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <SmallButton label={t('backup.saveSchedule')} filled busy={save.isPending} onPress={() => save.mutate(undefined)} />
      </View>
    </Card>
  );
}

/**
 * Admin → Backup: the schedule, a backup now, and the stored backups (verify, restore, delete). A restore
 * is only staged; it happens when the server restarts. Downloading a backup file stays on the website.
 */
export default function Backup() {
  const { api, t, serverUrl, language } = useSession();
  const qc = useQueryClient();
  const key = [serverUrl, 'admin', 'backups'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<BackupOverview>('/api/admin/backups') });
  const [verified, setVerified] = useState<Record<string, BackupVerification>>({});
  const set = (d: BackupOverview) => qc.setQueryData(key, d);
  const create = useAdminAction(async () => {
    await api.post<BackupFile>('/api/admin/backups');
    dialog.alert('Vidalune', t('backup.created'));
  }, [key]);
  const verify = useAdminAction(async (name: string) => {
    const r = await api.post<BackupVerification>(`/api/admin/backups/${encodeURIComponent(name)}/verify`);
    setVerified((v) => ({ ...v, [name]: r }));
  }, []);
  const restore = useAdminAction(async (b: BackupFile) => {
    set(await api.post<BackupOverview>(`/api/admin/backups/${encodeURIComponent(b.name)}/restore`, { confirm: true }));
    dialog.alert('Vidalune', t('backup.restoreStaged'));
  }, []);
  const remove = useAdminAction(async (b: BackupFile) => set(await api.del<BackupOverview>(`/api/admin/backups/${encodeURIComponent(b.name)}`)), []);
  const cancelRestore = useAdminAction(async () => set(await api.del<BackupOverview>('/api/admin/backups/restore/pending')), []);

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  // Restoring replaces everything since the backup: ask twice, the second time naming the date again.
  const askRestore = (b: BackupFile) => {
    const when = backupWhen(b.createdAt, language);
    confirmThen(`${t('backup.restoreTitle')}\n\n${t('backup.restoreText', { when })}`, t('backup.continue'), t('common.cancel'), () =>
      confirmThen(t('backup.restoreSure', { when, name: b.name }), t('backup.stageRestore'), t('common.cancel'), () => restore.mutate(b)),
    );
  };

  return (
    <AdminScreen title={t('admin.backup')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {d.pendingRestore && (
        <View style={{ backgroundColor: 'rgba(240,184,96,0.12)', borderColor: '#f0b860', borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 10 }}>
          <Text style={styles.body}>{t('backup.pending', { source: d.pendingRestore.source, by: d.pendingRestore.requestedBy })}</Text>
          <Text style={[styles.muted, { fontFamily: 'monospace' }]}>docker compose restart vidalune</Text>
          <View style={{ flexDirection: 'row' }}>
            <SmallButton label={t('backup.cancelRestore')} busy={cancelRestore.isPending} onPress={() => cancelRestore.mutate(undefined)} />
          </View>
        </View>
      )}

      <ScheduleCard key={JSON.stringify(d.schedule)} data={d} onSaved={set} />

      <Card title={t('backup.stored')} right={<SmallButton label={t('backup.now')} filled busy={create.isPending} onPress={() => create.mutate(undefined)} />}>
        <Text style={styles.muted}>{t('backup.storedIn', { folder: d.folder })}</Text>
        {d.backups.length === 0 ? (
          <Text style={styles.muted}>{t('backup.none')}</Text>
        ) : (
          d.backups.map((b) => {
            const v = verified[b.name];
            return (
              <View key={b.name} style={{ gap: 6, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={[styles.body, { fontWeight: '600' }]}>{backupWhen(b.createdAt, language)}</Text>
                  <Pill text={t(backupKindKey(b.kind))} />
                </View>
                <Text style={[styles.muted, { color: colors.faint }]} numberOfLines={1}>
                  {b.name} · {formatBytes(b.size)}
                </Text>
                {v ? <Text style={{ color: v.ok ? colors.ok : colors.danger, fontSize: 13 }}>{verifyLine(v, t)}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <SmallButton label={t('backup.verify')} busy={verify.isPending && verify.variables === b.name} onPress={() => verify.mutate(b.name)} />
                  <SmallButton label={t('backup.restore')} danger busy={restore.isPending && restore.variables === b} onPress={() => askRestore(b)} />
                  <SmallButton
                    label={t('backup.delete')}
                    danger
                    busy={remove.isPending && remove.variables === b}
                    onPress={() => confirmThen(`${t('backup.deleteTitle')}\n\n${t('backup.deleteText', { name: b.name })}`, t('backup.deleteBackup'), t('common.cancel'), () => remove.mutate(b))}
                  />
                </View>
              </View>
            );
          })
        )}
        <Text style={[styles.muted, { color: colors.faint }]}>{t('backup.downloadOnWebsite')}</Text>
      </Card>

      <Card title={t('backup.commandLine')}>
        <Text style={styles.muted}>{t('backup.archiveText')}</Text>
        <Text style={[styles.muted, { fontFamily: 'monospace', fontSize: 12 }]}>
          {'docker compose exec vidalune vidalune backup\ndocker compose exec vidalune vidalune backup list\ndocker compose exec vidalune vidalune backup verify\ndocker compose exec vidalune vidalune restore <backup-name>'}
        </Text>
        <Text style={styles.muted}>{t('backup.autoCopies')}</Text>
      </Card>
    </AdminScreen>
  );
}
