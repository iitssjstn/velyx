import { useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DiscoverCard, useCatalogSearch } from '../../components/Discover';
import { Artwork, PosterCard } from '../../components/media';
import { ErrorState, Heading, ProgressLine, styles } from '../../components/ui';
import { useDebounced } from '../../components/useDebounced';
import { episodeCode, progressFraction } from '../../lib/format';
import { searchQuery } from '../../lib/lists';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';
import type { SearchResults } from '../../lib/types';

/**
 * Searches movies, shows and episodes on the server while typing (after a short pause), and with
 * Seerr set up also the titles that are not in the library (they open their page, to request them).
 */
export default function Search() {
  const { api, t, serverUrl } = useSession();
  const [text, setText] = useState('');
  const query = searchQuery(useDebounced(text, 300));
  const q = useQuery({
    queryKey: [serverUrl, 'search', query],
    enabled: query !== null,
    queryFn: ({ signal }) => api.get<SearchResults>(`/api/search?q=${encodeURIComponent(query!)}`, { signal }),
    // Keep the previous results on screen while the next ones load: no flashing while typing.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  // With Seerr set up, also what is not in the library (below the library's own results).
  const catalog = useCatalogSearch(query);
  const r = query ? q.data : undefined;
  const empty = r && !r.movies.length && !r.shows.length && !r.episodes.length && !catalog.results.length && !catalog.isFetching;
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16 }}>
          <Feather name="search" size={18} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.faint}
            accessibilityLabel={t('tabs.search')}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={{ flex: 1, color: colors.ink, fontSize: 16 }}
          />
          {(q.isFetching || catalog.isFetching) && query ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          {text ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('search.clear')} hitSlop={10} onPress={() => setText('')}>
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {!query ? (
        <Text style={[styles.muted, { paddingHorizontal: 16 }]}>{t('search.hint')}</Text>
      ) : q.error && !r ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : empty ? (
        <Text style={[styles.muted, { paddingHorizontal: 16 }]}>{t('search.none', { query: r.query })}</Text>
      ) : r ? (
        <ScrollView keyboardShouldPersistTaps="handled" onScrollBeginDrag={Keyboard.dismiss} contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }}>
          {r.movies.length > 0 && <Row title={t('search.movies')} cards={r.movies} />}
          {r.shows.length > 0 && <Row title={t('search.shows')} cards={r.shows} />}
          {r.episodes.length > 0 && (
            <View style={{ gap: 12 }}>
              <Heading>{t('search.episodes')}</Heading>
              {r.episodes.map((e) => (
                <Pressable
                  key={e.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.showTitle} ${episodeCode(e.seasonNumber, e.episodeNumber)}${e.title ? ` ${e.title}` : ''}`}
                  onPress={() => router.push(`/show/${e.showId}`)}
                  style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingHorizontal: 16, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ width: 128 }}>
                    <Artwork path={e.stillPath} size="w500" label={episodeCode(e.seasonNumber, e.episodeNumber)} style={{ width: 128, height: 72, borderRadius: radius.sm }} />
                    {e.progress && !e.progress.completed ? (
                      <View style={{ marginTop: 3 }}>
                        <ProgressLine fraction={progressFraction(e.progress)} />
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1, justifyContent: 'center', gap: 2 }}>
                    <Text style={{ color: colors.ink, fontWeight: '600' }} numberOfLines={1}>{e.showTitle}</Text>
                    <Text style={styles.muted} numberOfLines={2}>
                      {episodeCode(e.seasonNumber, e.episodeNumber)}
                      {e.title ? ` · ${e.title}` : ''}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
          {catalog.results.length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Heading>{t('search.catalog')}</Heading>
              <FlatList
                horizontal
                data={catalog.results}
                keyExtractor={(c) => `${c.mediaType}-${c.tmdbId}`}
                renderItem={({ item }) => <DiscoverCard item={item} width={120} onPress={() => router.push(`/request/${item.mediaType}/${item.tmdbId}`)} />}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              />
            </View>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Row({ title, cards }: { title: string; cards: SearchResults['movies'] | SearchResults['shows'] }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Heading>{title}</Heading>
      <FlatList
        horizontal
        data={cards as Array<SearchResults['movies'][number] | SearchResults['shows'][number]>}
        keyExtractor={(c) => `${c.type}-${c.id}`}
        renderItem={({ item }) => <PosterCard card={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}
