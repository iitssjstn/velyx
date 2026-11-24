import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AdminScreen, Card } from '../../components/Admin';
import { Button, ErrorState, FocusPressable, Loading, styles } from '../../components/ui';
import { ago, formatRuntime } from '../../lib/format';
import { historyTarget, type WatchedEntry } from '../../lib/history';
import { useSession } from '../../lib/session';
import { radius } from '../../lib/theme';

const PAGE = 30;

/** Account → Watch history: what you watched on this server, newest first (as on the website). */
export default function History() {
  const { api, t, serverUrl } = useSession();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: [serverUrl, 'account-history', page],
    queryFn: () => api.get<{ total: number; items: WatchedEntry[] }>(`/api/account/history?page=${page}&limit=${PAGE}`),
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const pages = Math.max(1, Math.ceil(q.data.total / PAGE));
  const now = Date.now();
  return (
    <AdminScreen title={t('account.history')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Text style={styles.muted}>{t('history.hint')}</Text>
      {q.data.items.length === 0 ? (
        <Text style={styles.muted}>{t('history.empty')}</Text>
      ) : (
        <Card>
          {q.data.items.map((h) => {
            const when = ago(h.startedAt, now);
            const watched = formatRuntime(Math.round(h.watchedSec / 60));
            const target = historyTarget(h);
            return (
              <FocusPressable
                key={h.id}
                accessibilityRole={target ? 'link' : undefined}
                disabled={!target}
                onPress={() => target && router.push(target)}
                style={{ gap: 2, paddingVertical: 6, ...(Platform.isTV && { paddingHorizontal: 10, borderRadius: radius.sm }) }}
              >
                <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={1}>{h.title}{h.subtitle ? ` · ${h.subtitle}` : ''}</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {t(when.key, { n: when.n })}{watched ? ` · ${t('history.watched', { time: watched })}` : ''}{h.device ? ` · ${h.device}` : ''}
                </Text>
              </FocusPressable>
            );
          })}
        </Card>
      )}
      {pages > 1 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
          <Text style={[styles.muted, { flex: 1 }]}>{t('history.page', { page, pages })}</Text>
          <Button label={t('history.previous')} variant="ghost" disabled={page <= 1} onPress={() => setPage(page - 1)} />
          <Button label={t('history.next')} variant="ghost" disabled={page >= pages} onPress={() => setPage(page + 1)} />
        </View>
      )}
    </AdminScreen>
  );
}
