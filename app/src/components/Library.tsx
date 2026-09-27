import { FlatList, RefreshControl, Text } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { renderPoster, useGrid } from './media';
import { ErrorState, Loading, styles } from './ui';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import type { Card, Paged } from '../lib/types';

const PAGE = 60;

/** All movies or all shows as a poster grid, loaded page by page while scrolling. */
export function Library({ kind }: { kind: 'movies' | 'shows' }) {
  const { api, t, serverUrl } = useSession();
  const { columns, itemWidth } = useGrid();
  const q = useInfiniteQuery({
    queryKey: [serverUrl, kind, 'list'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<Paged<Card>>(`/api/${kind}?page=${pageParam}&limit=${PAGE}&sort=title`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.pages.flatMap((p) => p.items);
  return (
    <FlatList
      key={columns}
      data={items}
      numColumns={columns}
      keyExtractor={(c) => `${c.type}-${c.id}`}
      renderItem={renderPoster(itemWidth)}
      columnWrapperStyle={{ gap: 12 }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
      ListEmptyComponent={<Text style={styles.muted}>{t('list.empty')}</Text>}
    />
  );
}
