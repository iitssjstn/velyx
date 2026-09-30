import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Artwork, useWide } from './media';
import { Heading } from './ui';
import { errorMessage } from '../lib/connection';
import { DISCOVER_ROWS, discoverPath, discoverTarget, mergePages, type DiscoverPage, type DiscoverRow, type SeerrResult } from '../lib/discover';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import type { ShowDetail } from '../lib/types';

/** Opens a title from the catalog: plays what is here, otherwise its request page. */
export function useOpenDiscover() {
  const { api, t } = useSession();
  const [busy, setBusy] = useState(false);
  const open = async (item: SeerrResult) => {
    if (item.local?.type !== 'show') return router.push(discoverTarget(item) as never);
    setBusy(true);
    try {
      const show = await api.get<ShowDetail>(`/api/shows/${item.local.id}`);
      router.push(discoverTarget(item, show.upNext?.id ?? null) as never);
    } catch (err) {
      Alert.alert(t('common.error'), errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return { open, busy };
}

export function DiscoverCard({ item, onPress, width }: { item: SeerrResult; onPress: () => void; width: number }) {
  const { t } = useSession();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={item.inLibrary ? `${item.title}, ${t('discover.inLibrary')}` : item.title} onPress={onPress} style={{ width }}>
      <View>
        <Artwork path={item.posterPath} size="w342" label={item.title} style={{ width, height: width * 1.5, borderRadius: radius.md }} />
        {item.inLibrary ? (
          <View style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.bg, fontWeight: '800', fontSize: 13 }}>✓</Text>
          </View>
        ) : item.state ? (
          <View style={{ position: 'absolute', left: 6, right: 6, bottom: 6, alignItems: 'center' }}>
            <Text numberOfLines={1} style={{ backgroundColor: 'rgba(20,18,28,0.85)', color: colors.accent, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' }}>
              {t(`request.state.${item.state}`)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13, marginTop: 6 }}>{item.title}</Text>
      <Text style={{ color: colors.faint, fontSize: 12 }}>
        {item.mediaType === 'movie' ? t('request.movie') : t('request.show')}
        {item.year ? ` · ${item.year}` : ''}
      </Text>
    </Pressable>
  );
}

/** One row of the catalog; its next page loads when it is scrolled to the end. */
function DiscoverShelf({ spec, onOpen }: { spec: DiscoverRow; onOpen: (item: SeerrResult) => void }) {
  const { api, t, serverUrl } = useSession();
  const width = useWide() ? 150 : 120;
  const q = useInfiniteQuery({
    queryKey: [serverUrl, 'discover', spec.row, spec.genre ?? null],
    queryFn: ({ pageParam }) => api.get<DiscoverPage>(discoverPath(spec, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 10 * 60_000,
  });
  const items = mergePages(q.data?.pages ?? []);
  // Nothing (or Seerr away): the row is left out.
  if (!q.isLoading && items.length === 0) return null;
  const title = spec.genreName ? t(spec.title, { genre: t(spec.genreName) }) : t(spec.title);
  return (
    <View style={{ marginBottom: 24 }}>
      <Heading>{title}</Heading>
      {q.isLoading ? (
        <View style={{ height: width * 1.5, justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(r) => `${r.mediaType}-${r.tmdbId}`}
          renderItem={({ item }) => <DiscoverCard item={item} width={width} onPress={() => onOpen(item)} />}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          onEndReachedThreshold={1.5}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.accent} style={{ marginHorizontal: 16, height: width * 1.5 }} /> : null}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          showsHorizontalScrollIndicator={false}
        />
      )}
    </View>
  );
}

/**
 * With Seerr on the server: everything else there is to watch, in rows under the library. `rows`
 * grows as the home screen is scrolled, so rows further down are only loaded when they are near.
 */
export function DiscoverShelves({ rows }: { rows: number }) {
  const { api, serverUrl } = useSession();
  const status = useQuery({ queryKey: [serverUrl, 'seerr'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const { open } = useOpenDiscover();
  if (!status.data?.enabled) return null;
  return (
    <>
      {DISCOVER_ROWS.slice(0, rows).map((spec) => (
        <DiscoverShelf key={`${spec.row}-${spec.genre ?? ''}`} spec={spec} onOpen={(item) => void open(item)} />
      ))}
    </>
  );
}
