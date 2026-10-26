import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card } from '../../components/Admin';
import { ErrorState, Loading, styles } from '../../components/ui';
import type { HistoryItem } from '../../lib/admin';
import { ago, formatRuntime } from '../../lib/format';
import { useSession } from '../../lib/session';

/** Admin → Activity: what was watched lately, by whom and on what. */
export default function Activity() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'activity'], queryFn: () => api.get<{ total: number; items: HistoryItem[] }>('/api/admin/activity/history?page=1&limit=50') });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const now = Date.now();
  return (
    <AdminScreen title={t('admin.activity')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.data.items.length === 0 && <Text style={styles.muted}>{t('admin.noActivity')}</Text>}
      <Card>
        {q.data.items.map((h) => {
          const when = ago(h.startedAt, now);
          const watched = formatRuntime(Math.round(h.watchedSec / 60));
          return (
            <View key={h.id} style={{ gap: 2, paddingVertical: 4 }}>
              <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={1}>{h.title}{h.subtitle ? ` · ${h.subtitle}` : ''}</Text>
              <Text style={styles.muted} numberOfLines={1}>
                {h.username}{h.device ? ` · ${h.device}` : ''}{watched ? ` · ${watched}` : ''} · {t(when.key, { n: when.n })}
              </Text>
            </View>
          );
        })}
      </Card>
    </AdminScreen>
  );
}
