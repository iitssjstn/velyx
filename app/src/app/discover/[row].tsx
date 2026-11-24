import { ActivityIndicator, FlatList, RefreshControl, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { DiscoverCard, useOpenDiscover } from '../../components/Discover';
import { useGrid } from '../../components/media';
import { GridSkeleton } from '../../components/Skeleton';
import { ErrorState, styles } from '../../components/ui';
import { discoverPath, discoverRowFor, mergePages, type DiscoverPage } from '../../lib/discover';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

/** All of a catalog row (Trending, Coming soon, a genre …), loaded page by page, as on the website. */
export default function DiscoverRowScreen() {
  const { row, genre } = useLocalSearchParams<{ row: string; genre?: string }>();
  const spec = discoverRowFor(row, genre);
  const { api, t, serverUrl } = useSession();
  const { columns, itemWidth, side, gap } = useGrid();
  const { open } = useOpenDiscover();
  const status = useQuery({ queryKey: [serverUrl, 'seerr'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const q = useInfiniteQuery({
    queryKey: [serverUrl, 'discover', spec?.row ?? null, spec?.genre ?? null],
    queryFn: ({ pageParam }) => api.get<DiscoverPage>(discoverPath(spec!, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: !!spec && !!status.data?.enabled,
    staleTime: 60_000,
  });
  const title = !spec ? '' : spec.genreName ? t(spec.title, { genre: t(spec.genreName) }) : t(spec.title);
  const items = mergePages(q.data?.pages ?? []);
  const body = !spec ? (
    <ErrorState error={new Error(t('discover.empty'))} />
  ) : status.isLoading || (status.data?.enabled && q.isLoading) ? (
    <GridSkeleton />
  ) : status.data && !status.data.enabled ? (
    <ErrorState error={new Error(t('requests.off'))} />
  ) : !q.data ? (
    <ErrorState error={q.error ?? status.error} onRetry={() => void (status.data ? q.refetch() : status.refetch())} />
  ) : (
    <FlatList
      key={columns}
      data={items}
      numColumns={columns}
      keyExtractor={(r) => `${r.mediaType}-${r.tmdbId}`}
      renderItem={({ item }) => <DiscoverCard item={item} width={itemWidth} onPress={() => void open(item)} />}
      columnWrapperStyle={{ gap }}
      contentContainerStyle={{ padding: side, gap: gap + 4 }}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
      onEndReachedThreshold={1.5}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} /> : null}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
      ListEmptyComponent={<Text style={styles.muted}>{t('discover.empty')}</Text>}
    />
  );
  return (
    <>
      <Stack.Screen options={{ title }} />
      {body}
    </>
  );
}
