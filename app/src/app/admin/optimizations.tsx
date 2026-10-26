import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Pill, SmallButton, useAdminAction } from '../../components/Admin';
import { ErrorState, Loading, ProgressLine, styles } from '../../components/ui';
import { optimizationAction, optimizationTitle, type OptimizationItem } from '../../lib/admin';
import { useSession } from '../../lib/session';

/** Admin → Compatible copies: what is being made or waits, stopping it and starting it again. */
export default function Optimizations() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({
    queryKey: [serverUrl, 'admin', 'optimizations'],
    queryFn: () => api.get<{ paused: boolean; items: OptimizationItem[] }>('/api/admin/optimizations'),
    refetchInterval: (query) => (query.state.data?.items.some((i) => i.status === 'queued' || i.status === 'processing') ? 3000 : false),
  });
  const act = useAdminAction(
    (item: OptimizationItem) =>
      optimizationAction(item.status) === 'stop' ? api.post(`/api/admin/optimizations/${item.id}/stop`) : api.post(`/api/admin/media/${item.fileId}/optimizations`, { profile: item.profile }),
    [[serverUrl, 'admin']],
  );
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.items;
  return (
    <AdminScreen title={t('admin.optimizations')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {items.length === 0 && <Text style={styles.muted}>{t('admin.noCopies')}</Text>}
      {items.map((item) => {
        const action = optimizationAction(item.status);
        const pct = Math.round(item.progress * 100);
        return (
          <Card
            key={item.id}
            title={optimizationTitle(item)}
            right={action ? <SmallButton label={action === 'stop' ? t('admin.stop') : t('admin.resume')} danger={action === 'stop'} busy={act.isPending && act.variables?.id === item.id} onPress={() => act.mutate(item)} /> : undefined}
          >
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Pill text={t(`admin.opt.${item.status}`, { pct })} tone={item.status === 'processing' ? 'accent' : item.status === 'failed' ? 'danger' : item.status === 'ready' ? 'ok' : 'muted'} />
              <Text style={styles.muted}>{item.profile === 'compat-720p' ? '720p' : '1080p'}</Text>
            </View>
            {(item.status === 'processing' || item.status === 'paused') && <ProgressLine fraction={item.progress} />}
            {item.error && item.status === 'failed' ? <Text style={styles.error} numberOfLines={3}>{item.error}</Text> : null}
          </Card>
        );
      })}
    </AdminScreen>
  );
}
