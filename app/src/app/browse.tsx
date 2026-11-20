import { ActivityIndicator, FlatList, RefreshControl, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { renderPoster, useGrid } from '../components/media';
import { GridSkeleton } from '../components/Skeleton';
import { ErrorState, styles } from '../components/ui';
import { browsePath, filterQuery } from '../lib/collections';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import type { Card, Paged } from '../lib/types';

const PAGE = 60;

/** The movies or shows that match a smart collection's filters, loaded page by page. */
export default function Browse() {
  const params = useLocalSearchParams<Record<string, string>>();
  const kind = params.kind === 'shows' ? 'shows' : 'movies';
  const query = filterQuery(params);
  const { api, t, serverUrl } = useSession();
  const { columns, itemWidth, side, gap } = useGrid();
  const q = useInfiniteQuery({
    queryKey: [serverUrl, kind, 'browse', query],
    queryFn: ({ pageParam }) => api.get<Paged<Card>>(browsePath(kind, query, pageParam, PAGE)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <Stack.Screen options={{ title: params.title ?? '' }} />
      {q.isLoading ? (
        <GridSkeleton />
      ) : !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(c) => `${c.type}-${c.id}`}
          renderItem={renderPoster(itemWidth)}
          columnWrapperStyle={{ gap }}
          contentContainerStyle={{ padding: side, gap: gap + 4 }}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          onEndReachedThreshold={1.5}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} /> : null}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
          ListEmptyComponent={<Text style={styles.muted}>{t('collections.itemsEmpty')}</Text>}
        />
      )}
    </>
  );
}
