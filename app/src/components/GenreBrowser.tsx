import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DiscoverCard, useOpenDiscover } from './Discover';
import { renderPoster, useGrid } from './media';
import { ErrorState, Heading, styles } from './ui';
import { DISCOVER_ROWS, discoverPath, mergePages, type DiscoverPage, type DiscoverRow } from '../lib/discover';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import type { Card, Paged } from '../lib/types';

type Scope = 'library' | 'seerr';
type Kind = 'movies' | 'shows';
type Genre = { id: number; name: string; count: number };
type GenreOption = { id: number; name: string; count?: number; row?: DiscoverRow };
const PAGE = 60;

export function GenreBrowser() {
  const { api, t, serverUrl } = useSession();
  const params = useLocalSearchParams<{ scope?: string; kind?: string }>();
  const { columns, itemWidth } = useGrid();
  const [scope, setScope] = useState<Scope>(params.scope === 'seerr' ? 'seerr' : 'library');
  const [kind, setKind] = useState<Kind>(params.kind === 'shows' ? 'shows' : 'movies');
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const { open: openDiscover } = useOpenDiscover();
  const row = kind === 'movies' ? 'movies' : 'tv';

  useEffect(() => {
    if (params.scope === 'library' || params.scope === 'seerr') setScope(params.scope);
    if (params.kind === 'movies' || params.kind === 'shows') setKind(params.kind);
    setSelectedGenre(null);
  }, [params.scope, params.kind]);

  const localGenres = useQuery({
    queryKey: [serverUrl, 'genres', kind],
    queryFn: () => api.get<Genre[]>(`/api/genres?type=${kind}`),
    enabled: scope === 'library',
    staleTime: 5 * 60_000,
  });
  const seerrStatus = useQuery({
    queryKey: [serverUrl, 'seerr'],
    queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'),
    enabled: scope === 'seerr',
    staleTime: 5 * 60_000,
  });
  const seerrRows = DISCOVER_ROWS.filter((entry) => entry.genre !== undefined && entry.row === row);
  const genreChecks = useQueries({
    queries: seerrRows.map((entry) => ({
      queryKey: [serverUrl, 'genre-index', entry.row, entry.genre],
      queryFn: () => api.get<DiscoverPage>(discoverPath(entry, 1)),
      enabled: scope === 'seerr' && Boolean(seerrStatus.data?.enabled),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const seerrGenres: GenreOption[] = seerrRows.flatMap((entry, index) => {
    const count = genreChecks[index]?.data?.results.length ?? 0;
    return count && entry.genre ? [{ id: entry.genre, name: entry.genreName ? t(entry.genreName) : String(entry.genre), count, row: entry }] : [];
  });
  const indexError = genreChecks.find((query) => query.error)?.error;

  const localResults = useInfiniteQuery({
    queryKey: [serverUrl, kind, 'genre', selectedGenre],
    queryFn: ({ pageParam }) => api.get<Paged<Card>>(`/api/${kind}?page=${pageParam}&limit=${PAGE}&sort=title&genre=${selectedGenre}`),
    initialPageParam: 1,
    getNextPageParam: (last) => last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    enabled: scope === 'library' && selectedGenre !== null,
  });
  const catalogResults = useInfiniteQuery({
    queryKey: [serverUrl, 'seerr', 'genre', row, selectedGenre],
    queryFn: ({ pageParam }) => api.get<DiscoverPage>(discoverPath({ row, genre: selectedGenre!, title: 'discover.movieGenre' }, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last) => last.page < last.totalPages ? last.page + 1 : undefined,
    enabled: scope === 'seerr' && selectedGenre !== null && Boolean(seerrStatus.data?.enabled),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const options: GenreOption[] = scope === 'library'
    ? (localGenres.data ?? []).map((genre) => ({ ...genre }))
    : seerrGenres;
  const selectedName = options.find((genre) => genre.id === selectedGenre)?.name;
  const localItems = localResults.data?.pages.flatMap((page) => page.items) ?? [];
  const catalogItems = mergePages(catalogResults.data?.pages ?? []);
  const toggle = (next: Scope | Kind, type: 'scope' | 'kind') => {
    setSelectedGenre(null);
    if (type === 'scope') setScope(next as Scope);
    else setKind(next as Kind);
  };
  const sourceButton = (value: Scope, label: string) => (
    <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: scope === value }} onPress={() => toggle(value, 'scope')} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: scope === value ? colors.accent : colors.raised }}>
      <Text style={{ color: scope === value ? colors.accentInk : colors.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  const kindButton = (value: Kind, label: string) => (
    <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: kind === value }} onPress={() => toggle(value, 'kind')} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: kind === value ? colors.accent : colors.raised }}>
      <Text style={{ color: kind === value ? colors.accentInk : colors.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  const header = (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 12 }}>
      <Heading>{selectedName ?? t('genres.title')}</Heading>
      <Text style={[styles.muted, { paddingHorizontal: 16 }]}>{t('genres.intro')}</Text>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
        {sourceButton('library', t('genres.library'))}
        {sourceButton('seerr', t('genres.catalog'))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
        {kindButton('movies', t('genres.movies'))}
        {kindButton('shows', t('genres.shows'))}
      </View>
      {selectedGenre !== null && (
        <Pressable accessibilityRole="button" onPress={() => setSelectedGenre(null)} style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>‹ {t('genres.all')}</Text>
        </Pressable>
      )}
    </View>
  );

  if (scope === 'seerr' && (seerrStatus.error || (seerrStatus.data && !seerrStatus.data.enabled))) {
    return <SafeAreaView edges={['top']} style={styles.screen}>{header}<ErrorState error={seerrStatus.error ?? new Error(t('genres.catalogOff'))} onRetry={() => void seerrStatus.refetch()} /></SafeAreaView>;
  }
  if (scope === 'library' && localGenres.error) return <SafeAreaView edges={['top']} style={styles.screen}>{header}<ErrorState error={localGenres.error} onRetry={() => void localGenres.refetch()} /></SafeAreaView>;
  if (scope === 'seerr' && indexError && selectedGenre === null) return <SafeAreaView edges={['top']} style={styles.screen}>{header}<ErrorState error={indexError} onRetry={() => { void seerrStatus.refetch(); genreChecks.forEach((query) => void query.refetch()); }} /></SafeAreaView>;

  if (selectedGenre === null) {
    const waiting = scope === 'library' ? localGenres.isLoading : seerrStatus.isLoading || genreChecks.some((query) => query.isLoading);
    if (waiting) return <SafeAreaView edges={['top']} style={styles.screen}>{header}<ActivityIndicator color={colors.accent} size="large" /></SafeAreaView>;
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        {header}
        {options.length === 0 ? <Text style={[styles.muted, { paddingHorizontal: 32 }]}>{t('genres.none')}</Text> : (
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingBottom: 24 }}>
            {options.map((genre) => (
              <Pressable key={genre.id} accessibilityRole="button" onPress={() => setSelectedGenre(genre.id)} style={{ width: '48%', minHeight: 52, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={{ color: colors.ink, flexShrink: 1 }} numberOfLines={1}>{genre.name}</Text>
                {scope === 'library' && <Text style={{ color: colors.faint, fontSize: 12 }}>{genre.count}</Text>}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  if (scope === 'library') {
    if (localResults.isLoading) return <SafeAreaView edges={['top']} style={styles.screen}>{header}<ActivityIndicator color={colors.accent} size="large" /></SafeAreaView>;
    if (localResults.error) return <SafeAreaView edges={['top']} style={styles.screen}>{header}<ErrorState error={localResults.error} onRetry={() => void localResults.refetch()} /></SafeAreaView>;
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        {header}
        <FlatList key={columns} data={localItems} numColumns={columns} keyExtractor={(item) => `${item.type}-${item.id}`} renderItem={renderPoster(itemWidth)} columnWrapperStyle={{ gap: 12 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} onEndReached={() => localResults.hasNextPage && !localResults.isFetchingNextPage && void localResults.fetchNextPage()} onEndReachedThreshold={0.6} ListEmptyComponent={<Text style={styles.muted}>{t('genres.none')}</Text>} />
      </SafeAreaView>
    );
  }

  if (catalogResults.isLoading) return <SafeAreaView edges={['top']} style={styles.screen}>{header}<ActivityIndicator color={colors.accent} size="large" /></SafeAreaView>;
  if (catalogResults.error) return <SafeAreaView edges={['top']} style={styles.screen}>{header}<ErrorState error={catalogResults.error} onRetry={() => void catalogResults.refetch()} /></SafeAreaView>;
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      {header}
      <FlatList key={columns} data={catalogItems} numColumns={columns} keyExtractor={(item) => `${item.mediaType}-${item.tmdbId}`} renderItem={({ item }) => <DiscoverCard item={item} width={itemWidth} onPress={() => void openDiscover(item)} />} columnWrapperStyle={{ gap: 12 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} onEndReached={() => catalogResults.hasNextPage && !catalogResults.isFetchingNextPage && void catalogResults.fetchNextPage()} onEndReachedThreshold={0.6} ListEmptyComponent={<Text style={styles.muted}>{t('genres.none')}</Text>} />
    </SafeAreaView>
  );
}