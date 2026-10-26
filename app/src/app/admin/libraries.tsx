import { Alert, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Pill, SmallButton, useAdminAction } from '../../components/Admin';
import { ErrorState, Loading, styles } from '../../components/ui';
import type { AdminLibrary } from '../../lib/admin';
import { ago } from '../../lib/format';
import { useSession } from '../../lib/session';

/** Admin → Libraries: each library with how much is in it, and a scan for new files. */
export default function Libraries() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({
    queryKey: [serverUrl, 'admin', 'libraries'],
    queryFn: () => api.get<AdminLibrary[]>('/api/libraries'),
    refetchInterval: (query) => (query.state.data?.some((l) => l.scanning || l.queued) ? 3000 : false),
  });
  const scan = useAdminAction(async (l: AdminLibrary) => {
    await api.post(`/api/libraries/${l.id}/scan`, {});
    Alert.alert('Vidalune', t('admin.scanStarted', { name: l.name }));
  }, [[serverUrl, 'admin']]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const now = Date.now();
  return (
    <AdminScreen title={t('admin.libraries')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.data.map((l) => {
        const when = l.lastScanAt ? ago(l.lastScanAt, now) : null;
        return (
          <Card key={l.id} title={l.name} right={<SmallButton label={t('admin.scan')} filled busy={scan.isPending && scan.variables?.id === l.id} disabled={Boolean(l.scanning) || l.queued} onPress={() => scan.mutate(l)} />}>
            <Text style={styles.body}>{t(l.type === 'movies' ? 'admin.items.movies' : 'admin.items.shows', { n: l.itemCount })}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {l.scanning ? <Pill text={t('admin.scan.scanning')} tone="accent" /> : l.queued ? <Pill text={t('admin.waiting')} /> : null}
              {!l.available && <Pill text={t('admin.unavailable')} tone="danger" />}
              {l.lastScanStatus === 'error' && <Pill text={t('admin.scan.failed')} tone="danger" />}
              {when && <Text style={styles.muted}>{t(when.key, { n: when.n })}</Text>}
            </View>
          </Card>
        );
      })}
    </AdminScreen>
  );
}
