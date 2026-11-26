import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AdminScreen, Card } from '../../components/Admin';
import { Hint, StatusLine, SwitchRow, useServerSettings } from '../../components/AdminSettings';
import { Button, ErrorState, Field, Loading, styles } from '../../components/ui';
import { changedFields, hasChanges, isTimeOfDay, normalizeTime, prefetchLine, type ServerSettings } from '../../lib/adminSettings';
import { dialog } from '../../lib/dialog';
import { useSession } from '../../lib/session';

const windowFields = (s: ServerSettings) => ({ maintenanceStart: s.maintenanceStart, maintenanceEnd: s.maintenanceEnd, maintenanceOutside: s.maintenanceOutside, subtitlePrefetch: s.subtitlePrefetch });
const detectionFields = (s: ServerSettings) => ({ segmentDetection: s.segmentDetection, segmentVideo: s.segmentVideo, shareDetection: s.shareDetection });

/** Admin → Maintenance: when background work may run, preparing files ahead of time, and intro detection. */
export default function Maintenance() {
  const { t } = useSession();
  const { query: q } = useServerSettings();
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <AdminScreen title={t('admin.maintenance')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <WindowPanel s={q.data} />
      <DetectionPanel s={q.data} />
    </AdminScreen>
  );
}

function WindowPanel({ s }: { s: ServerSettings }) {
  const { t } = useSession();
  const { save } = useServerSettings();
  const [form, setForm] = useState(windowFields(s));
  useEffect(() => setForm(windowFields(s)), [s]);
  const line = prefetchLine(s);
  const submit = () => {
    const next = { ...form, maintenanceStart: normalizeTime(form.maintenanceStart), maintenanceEnd: normalizeTime(form.maintenanceEnd) };
    if (!isTimeOfDay(next.maintenanceStart) || !isTimeOfDay(next.maintenanceEnd)) return dialog.alert(t('common.error'), t('settings2.maintenance.timeInvalid'));
    setForm(next);
    const changes = changedFields(windowFields(s), next);
    if (!hasChanges(changes)) return dialog.alert('Vidalune', t('settings2.noChanges'));
    save.mutate(changes);
  };
  return (
    <Card title={t('settings2.maintenance.title')}>
      <Text style={styles.muted}>{t('settings2.maintenance.text')}</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field label={t('settings2.maintenance.start')} value={form.maintenanceStart} placeholder="02:00" keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(v) => setForm({ ...form, maintenanceStart: v })} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={t('settings2.maintenance.end')} value={form.maintenanceEnd} placeholder="06:00" keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(v) => setForm({ ...form, maintenanceEnd: v })} />
        </View>
      </View>
      <Hint>{t('settings2.maintenance.serverTime', { time: s.serverTime, zone: s.serverTimeZone })}</Hint>
      <SwitchRow label={t('settings2.maintenance.outside')} hint={t('settings2.maintenance.outsideHint')} value={form.maintenanceOutside} onChange={(v) => setForm({ ...form, maintenanceOutside: v })} />
      <SwitchRow label={t('settings2.maintenance.prefetch')} hint={t('settings2.maintenance.prefetchHint')} value={form.subtitlePrefetch} onChange={(v) => setForm({ ...form, subtitlePrefetch: v })}>
        {line && (
          <StatusLine
            text={
              (line.key === 'done' ? t('settings2.maintenance.prefetchDone') : t(line.key === 'one' ? 'settings2.maintenance.prefetchOne' : 'settings2.maintenance.prefetchOther', { count: line.count })) +
              (line.waitsForWindow ? ` ${t('settings2.maintenance.prefetchWindow')}` : '')
            }
          />
        )}
      </SwitchRow>
      <Button label={t('settings2.save')} busy={save.isPending} onPress={submit} />
    </Card>
  );
}

function DetectionPanel({ s }: { s: ServerSettings }) {
  const { t } = useSession();
  const { save } = useServerSettings();
  const [form, setForm] = useState(detectionFields(s));
  useEffect(() => setForm(detectionFields(s)), [s]);
  const submit = () => {
    const changes = changedFields(detectionFields(s), form);
    if (!hasChanges(changes)) return dialog.alert('Vidalune', t('settings2.noChanges'));
    save.mutate(changes);
  };
  return (
    <Card title={t('settings2.detection.title')}>
      <SwitchRow label={t('settings2.detection.segments')} hint={t('settings2.detection.segmentsHint')} value={form.segmentDetection} onChange={(v) => setForm({ ...form, segmentDetection: v })} />
      <SwitchRow indent disabled={!form.segmentDetection} label={t('settings2.detection.video')} hint={t('settings2.detection.videoHint')} value={form.segmentVideo} onChange={(v) => setForm({ ...form, segmentVideo: v })} />
      <SwitchRow indent disabled={!form.segmentDetection} label={t('settings2.detection.share')} hint={t('settings2.detection.shareHint')} value={form.shareDetection} onChange={(v) => setForm({ ...form, shareDetection: v })} />
      <Button label={t('settings2.save')} busy={save.isPending} onPress={submit} />
    </Card>
  );
}
