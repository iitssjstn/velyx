import { FlatList, RefreshControl, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { renderPoster, useGrid } from '../../components/media';
import { GridSkeleton } from '../../components/Skeleton';
import { ErrorState, styles } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';
import type { Card } from '../../lib/types';

/** The whole watchlist or all favorites (movies and shows), as on the server. */
export default function SavedList() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const list = name === 'favorites' ? 'favorites' : 'watchlist';
  const { api, t, serverUrl } = useSession();
  const { columns, itemWidth } = useGrid();
  const q = useQuery({ queryKey: [serverUrl, 'list', list], queryFn: () => api.get<Card[]>(`/api/${list}`) });
  const title = t(list === 'favorites' ? 'lists.favorites' : 'lists.watchlist');
  return (
    <>
      <Stack.Screen options={{ title }} />
      {q.isLoading ? (
        <GridSkeleton />
      ) : !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          key={columns}
          data={q.data}
          numColumns={columns}
          keyExtractor={(c) => `${c.type}-${c.id}`}
          renderItem={renderPoster(itemWidth)}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 16, gap: 16 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
          ListEmptyComponent={<Text style={styles.muted}>{t(list === 'favorites' ? 'lists.emptyFavorites' : 'lists.emptyWatchlist')}</Text>}
        />
      )}
    </>
  );
}
