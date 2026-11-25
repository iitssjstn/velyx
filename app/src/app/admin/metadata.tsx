import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Pill, SmallButton, useAdminAction } from '../../components/Admin';
import { FixMatch } from '../../components/AdminTitleMenu';
import { ErrorState, Loading, styles } from '../../components/ui';
import { dialog } from '../../lib/dialog';
import { refreshNotice, refreshPath } from '../../lib/adminItem';
import { fileName, reviewList, type ReviewItem } from '../../lib/adminPages';
import { useSession } from '../../lib/session';

/**
 * Admin → Metadata: the movies and shows the server could not recognise for sure, with Fix match
 * (search TMDB and pick) and Refresh. The language and adult titles stay on the website.
 */
export default function Metadata() {
  const { api, t, serverUrl } = useSession();
  const [fixing, setFixing] = useState<ReviewItem | null>(null);
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'review'], queryFn: () => api.get<{ tmdbConfigured: boolean; movies: ReviewItem[]; shows: ReviewItem[] }>('/api/admin/review') });
  const refresh = useAdminAction(
    async (item: ReviewItem) => {
      const r = await api.post<{ result: string }>(refreshPath(item.type, item.id));
      dialog.alert('Vidalune', t(refreshNotice(r.result)));
    },
    [[serverUrl]],
  );
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const items = reviewList(q.data);
  return (
    <AdminScreen title={t('admin.metadata')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {!q.data.tmdbConfigured && <Text style={styles.error}>{t('metadata.noTmdb')}</Text>}
      <Text style={styles.muted}>{t('metadata.hint')}</Text>
      {items.length === 0 ? (
        <Card>
          <Text style={styles.muted}>{t('metadata.none')}</Text>
        </Card>
      ) : (
        items.map((item) => {
          const file = fileName(item.samplePath);
          return (
            <Card key={`${item.type}-${item.id}`}>
              <View style={{ gap: 4 }}>
                <Text style={[styles.body, { fontWeight: '600' }]}>{item.title}</Text>
                <Text style={styles.muted}>
                  {t(item.type === 'movie' ? 'metadata.movie' : 'metadata.show')} · {t('metadata.readAs', { title: item.parsedTitle })}
                  {item.parsedYear ? ` (${item.parsedYear})` : ''}
                </Text>
                {file ? <Text style={styles.muted} numberOfLines={1}>{file}</Text> : null}
                <Pill text={item.confidence === null ? t('metadata.notFound') : t('metadata.sure', { n: Math.round(item.confidence * 100) })} tone={item.confidence === null ? 'danger' : 'warn'} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <SmallButton label={t('adminItem.fixMatch')} filled onPress={() => setFixing(item)} />
                <SmallButton label={t('adminItem.refreshMetadata')} busy={refresh.isPending && refresh.variables === item} onPress={() => refresh.mutate(item)} />
              </View>
            </Card>
          );
        })
      )}
      {fixing && <FixMatch type={fixing.type} id={fixing.id} query={fixing.parsedTitle || fixing.title} year={fixing.parsedYear} follow={false} onClose={() => setFixing(null)} />}
    </AdminScreen>
  );
}
