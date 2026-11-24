import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { renderPoster, useGrid } from '../../components/media';
import { GridSkeleton } from '../../components/Skeleton';
import { ErrorState, styles } from '../../components/ui';
import type { CollectionSummary } from '../../lib/collections';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';
import type { Card } from '../../lib/types';

/** One collection: its description and what it holds. */
export default function Collection() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, t, serverUrl } = useSession();
  const { columns, itemWidth, side, gap } = useGrid();
  const q = useQuery({ queryKey: [serverUrl, 'collection', id], queryFn: () => api.get<CollectionSummary & { items: Card[] }>(`/api/collections/${id}`) });
  return (
    <>
      <Stack.Screen options={{ title: q.data?.name ?? '' }} />
      {q.isLoading ? (
        <GridSkeleton />
      ) : !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          key={columns}
          data={q.data.items}
          numColumns={columns}
          keyExtractor={(c) => `${c.type}-${c.id}`}
          renderItem={renderPoster(itemWidth)}
          columnWrapperStyle={{ gap }}
          contentContainerStyle={{ padding: side, gap: gap + 4 }}
          ListHeaderComponent={
            <View style={{ gap: 6, marginBottom: 8 }}>
              <Text style={styles.muted}>{t('collections.itemCount', { n: q.data.itemCount })}</Text>
              {q.data.overview ? <Text style={styles.body}>{q.data.overview}</Text> : null}
            </View>
          }
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
          ListEmptyComponent={<Text style={styles.muted}>{t('collections.itemsEmpty')}</Text>}
        />
      )}
    </>
  );
}
