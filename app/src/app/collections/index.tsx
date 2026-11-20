import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Artwork, useGrid } from '../../components/media';
import { GridSkeleton } from '../../components/Skeleton';
import { ErrorState, FocusPressable, FocusRing, Heading, Lift, styles } from '../../components/ui';
import { smartHref, smartNameKey, type CollectionSummary, type SmartCollection } from '../../lib/collections';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';

/** Collections: the smart collections (saved filters) and the collections of the library, as on the website. */
export default function Collections() {
  const { api, t, serverUrl } = useSession();
  const { itemWidth, side, gap } = useGrid();
  const smart = useQuery({ queryKey: [serverUrl, 'collections', 'smart'], queryFn: () => api.get<SmartCollection[]>('/api/collections/smart') });
  const list = useQuery({ queryKey: [serverUrl, 'collections'], queryFn: () => api.get<CollectionSummary[]>('/api/collections') });
  const refresh = () => {
    void smart.refetch();
    void list.refetch();
  };
  const grid = (children: React.ReactNode) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, rowGap: gap + 8, paddingHorizontal: side }}>{children}</View>;
  return (
    <>
      <Stack.Screen options={{ title: t('collections.title') }} />
      {list.isLoading ? (
        <GridSkeleton />
      ) : !list.data ? (
        <ErrorState error={list.error} onRetry={refresh} />
      ) : (
        <ScrollView
          style={styles.screen}
          contentContainerStyle={{ paddingVertical: 16, gap: 8 }}
          refreshControl={<RefreshControl refreshing={list.isRefetching || smart.isRefetching} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}
        >
          {smart.data && smart.data.length > 0 && (
            <>
              <Heading>{t('collections.smart')}</Heading>
              {grid(
                smart.data.map((c) => {
                  const nameKey = smartNameKey(c);
                  const name = nameKey ? t(nameKey) : c.name;
                  return <Tile key={c.key} width={itemWidth} name={name} poster={c.posterPath} line={`${c.count} · ${t(c.kind === 'movies' ? 'collections.movies' : 'collections.shows')}`} onPress={() => router.push(smartHref(c, name) as never)} />;
                }),
              )}
              <View style={{ height: 16 }} />
            </>
          )}
          <Heading>{t('collections.title')}</Heading>
          {list.data.length === 0 ? (
            <Text style={[styles.muted, { paddingHorizontal: side }]}>{t('collections.empty')}</Text>
          ) : (
            grid(list.data.map((c) => <Tile key={c.id} width={itemWidth} name={c.name} poster={c.posterPath} line={t('collections.itemCount', { n: c.itemCount })} onPress={() => router.push(`/collections/${c.id}`)} />))
          )}
        </ScrollView>
      )}
    </>
  );
}

function Tile({ width, name, poster, line, onPress }: { width: number; name: string; poster: string | null; line: string; onPress: () => void }) {
  return (
    <FocusPressable accessibilityRole="button" accessibilityLabel={name} onPress={onPress} style={{ width }}>
      {(focused) => (
        <>
          <Lift focused={focused}>
            <Artwork path={poster} size="w342" label={name} style={{ width, height: width * 1.5, borderRadius: radius.md }} />
            <FocusRing focused={focused} />
          </Lift>
          <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13, marginTop: 6 }}>{name}</Text>
          <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 12 }}>{line}</Text>
        </>
      )}
    </FocusPressable>
  );
}
