import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Pill, SmallButton, confirmThen, useAdminAction } from '../../components/Admin';
import { Button, ErrorState, Loading, ProgressLine, styles } from '../../components/ui';
import { Hint, OptionList, SwitchRow, useServerSettings } from '../../components/AdminSettings';
import {
  intervalChoices,
  intervalText,
  libraryState,
  phaseKey,
  scanBody,
  scanChanges,
  scanForm,
  scanFraction,
  scanSummary,
  type LibraryList,
  type LibraryRow,
  type ScanForm,
  type ScanKind,
  type ScanSettingsData,
} from '../../lib/adminLibraries';
import { colors } from '../../lib/theme';
import { ago } from '../../lib/format';
import { useSession } from '../../lib/session';
import { dialog } from '../../lib/dialog';

/** Admin → Libraries: each library with its state and scans; add one, or open one to edit it. */
export default function Libraries() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({
    queryKey: [serverUrl, 'admin', 'libraries'],
    queryFn: () => api.get<LibraryList>('/api/libraries'),
    refetchInterval: (query) => (query.state.data?.libraries.some((l) => l.scanning || l.queued) ? 3000 : false),
  });
  const scan = useAdminAction(async ({ l, kind }: { l: LibraryRow; kind: ScanKind }) => {
    await api.post(`/api/libraries/${l.id}/scan`, scanBody(kind));
    dialog.alert('Vidalune', t('libraries.scanQueued'));
  }, [[serverUrl, 'admin']]);
  const scanAll = useAdminAction(async () => {
    await api.post('/api/libraries/scan-all', {});
    dialog.alert('Vidalune', t('libraries.scanQueued'));
  }, [[serverUrl, 'admin']]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const now = Date.now();
  const { libraries } = q.data;
  return (
    <AdminScreen title={t('admin.libraries')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Text style={styles.muted}>{t('libraries.intro')}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <SmallButton label={t('libraries.add')} filled onPress={() => router.push('/admin/library')} />
        {libraries.length > 0 && <SmallButton label={t('libraries.scanAll')} busy={scanAll.isPending} onPress={() => scanAll.mutate(undefined)} />}
      </View>
      {libraries.length === 0 && (
        <Card>
          <Text style={styles.muted}>{t('libraries.none')}</Text>
          <Button label={t('libraries.add')} onPress={() => router.push('/admin/library')} />
        </Card>
      )}
      {libraries.map((l) => {
        const state = libraryState(l);
        const when = l.lastScanAt ? t(ago(l.lastScanAt, now).key, { n: ago(l.lastScanAt, now).n }) : '';
        const busy = state === 'scanning' || state === 'queued';
        const pending = (kind: ScanKind) => scan.isPending && scan.variables?.l.id === l.id && scan.variables.kind === kind;
        const fraction = scanFraction(l);
        return (
          <Card key={l.id} title={l.name} right={<SmallButton label={t('libraries.edit')} onPress={() => router.push(`/admin/library?id=${l.id}`)} />}>
            <Text style={styles.muted} numberOfLines={1}>{l.path}</Text>
            <Text style={styles.body}>
              {t(l.type === 'movies' ? 'admin.items.movies' : 'admin.items.shows', { n: l.itemCount })} · {t('libraries.files', { n: l.fileCount })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {!l.available && <Pill text={t('libraries.unavailable')} tone="danger" />}
              {l.available && l.watching && <Pill text={t('libraries.autoUpdating')} tone="ok" />}
              {l.available && l.watchError ? <Pill text={t('libraries.autoUpdateOff', { error: l.watchError })} tone="warn" /> : null}
            </View>
            {state === 'scanning' && l.scanning ? (
              <View style={{ gap: 6 }}>
                <Text style={styles.body}>
                  {t(phaseKey(l.scanning.phase))}
                  {l.scanning.total > 0 ? ` · ${l.scanning.processed}/${l.scanning.total}` : ''}
                </Text>
                <ProgressLine fraction={fraction ?? 0.05} />
              </View>
            ) : state === 'queued' ? (
              <Text style={styles.muted}>{t('libraries.waiting')}</Text>
            ) : state === 'empty' ? (
              <View style={{ gap: 8 }}>
                <Text style={[styles.body, { color: '#f0b860' }]}>{t('libraries.driveEmpty', { count: l.fileCount })}</Text>
                <View style={{ flexDirection: 'row' }}>
                  <SmallButton
                    label={t('libraries.driveEmptyConfirm')}
                    danger
                    busy={pending('confirmEmpty')}
                    onPress={() => confirmThen(t('libraries.driveEmptyText', { name: l.name, path: l.path, count: l.fileCount }), t('libraries.driveEmptyConfirm'), t('common.cancel'), () => scan.mutate({ l, kind: 'confirmEmpty' }))}
                  />
                </View>
              </View>
            ) : state === 'error' ? (
              <Text style={styles.error}>{t('libraries.lastFailed', { when, message: l.lastScanMessage ?? '' })}</Text>
            ) : state === 'ok' ? (
              <Text style={styles.muted}>
                {t('libraries.lastScanned', { when })}
                {l.lastScanMessage ? `: ${scanSummary(l.lastScanMessage, t)}` : ''}
              </Text>
            ) : (
              <Text style={styles.muted}>{t('libraries.neverScanned')}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <SmallButton label={t('libraries.scanNew')} filled busy={pending('new')} disabled={busy} onPress={() => scan.mutate({ l, kind: 'new' })} />
              <SmallButton label={t('libraries.refreshMetadata')} busy={pending('metadata')} disabled={busy} onPress={() => scan.mutate({ l, kind: 'metadata' })} />
              <SmallButton label={t('libraries.reanalyse')} busy={pending('full')} disabled={busy} onPress={() => scan.mutate({ l, kind: 'full' })} />
            </View>
          </Card>
        );
      })}
      <ScanSettings />
    </AdminScreen>
  );
}

/** The scan settings (as on the website's Libraries page); saves only its own fields that changed. */
function ScanSettings() {
  const { t } = useSession();
  const { query, save } = useServerSettings();
  const data = query.data as unknown as ScanSettingsData | undefined;
  const [form, setForm] = useState<ScanForm | null>(null);
  useEffect(() => {
    if (data) setForm(scanForm(data));
  }, [data]);
  const label = (minutes: number) => {
    const x = intervalText(minutes);
    return t(x.key, { n: x.n });
  };
  if (!data || !form) {
    return <Card title={t('libraries.scanSettings')}>{query.isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.error}>{t('common.error')}</Text>}</Card>;
  }
  const changes = scanChanges(scanForm(data), form);
  return (
    <Card title={t('libraries.scanSettings')}>
      <Text style={styles.muted}>{t('libraries.scanSettingsText')}</Text>
      <Text style={styles.label}>{t('libraries.schedule')}</Text>
      <OptionList
        value={form.interval}
        options={intervalChoices(form.interval).map((v) => ({
          value: v,
          label: v === '' ? t('libraries.intervalDefault', { interval: label(data.scanIntervalDefault).toLowerCase() }) : label(Number(v)),
        }))}
        onChange={(interval) => setForm({ ...form, interval })}
      />
      <Hint>{t('libraries.intervalHint')}</Hint>
      <SwitchRow label={t('libraries.watchFolders')} hint={t('libraries.watchFoldersHint')} value={form.watchFolders} onChange={(watchFolders) => setForm({ ...form, watchFolders })} />
      <SwitchRow label={t('libraries.scanOnStartup')} hint={t('libraries.scanOnStartupHint')} value={form.scanOnStartup} onChange={(scanOnStartup) => setForm({ ...form, scanOnStartup })} />
      <SwitchRow label={t('libraries.defer')} hint={t('libraries.deferHint')} value={form.deferScansWhilePlaying} onChange={(deferScansWhilePlaying) => setForm({ ...form, deferScansWhilePlaying })} />
      <Button label={t('libraries.saveSettings')} busy={save.isPending} disabled={Object.keys(changes).length === 0} onPress={() => save.mutate(changes as never)} />
    </Card>
  );
}
