import { Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, SmallButton, useAdminAction } from '../../components/Admin';
import { ErrorState, Loading, styles } from '../../components/ui';
import type { AdminNotification } from '../../lib/admin';
import { ago } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

/** Admin → Notifications: what Vidalune did by itself or noticed (a failed scan, a new device, a full disk). */
export default function Notifications() {
  const { api, t, serverUrl, language } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'notifications', 'list', language], queryFn: () => api.get<{ items: AdminNotification[]; unread: number }>('/api/admin/notifications') });
  const read = useAdminAction(() => api.post('/api/admin/notifications/read'), [[serverUrl, 'admin', 'notifications']]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const now = Date.now();
  return (
    <AdminScreen title={t('admin.notifications')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.data.unread > 0 && <SmallButton label={t('admin.markRead')} busy={read.isPending} onPress={() => read.mutate(undefined)} />}
      {q.data.items.length === 0 && <Text style={styles.muted}>{t('admin.noNotifications')}</Text>}
      {q.data.items.map((n) => {
        const when = ago(n.createdAt, now);
        return (
          <Card key={n.id}>
            <Text style={[styles.body, { fontWeight: '600', color: n.read ? colors.muted : colors.ink }]}>{n.title}</Text>
            <Text style={styles.muted}>{n.body}</Text>
            <Text style={[styles.muted, { color: colors.faint }]}>{t(when.key, { n: when.n })}</Text>
          </Card>
        );
      })}
    </AdminScreen>
  );
}
