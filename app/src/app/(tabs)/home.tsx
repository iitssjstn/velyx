import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ContinueShelf, Shelf, useWide } from '../../components/media';
import { ShelvesSkeleton } from '../../components/Skeleton';
import { ErrorState, styles } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';
import type { HomeData } from '../../lib/types';

export default function Home() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'home'], queryFn: () => api.get<HomeData>('/api/home') });
  const wide = useWide();
  if (q.isLoading)
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <View style={{ padding: 16, paddingBottom: 20 }}>
          <Logo />
        </View>
        <ShelvesSkeleton poster={wide ? 150 : 120} />
      </SafeAreaView>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const empty = !d.continueWatching.length && !d.recentlyAdded.length && !d.movies.length && !d.shows.length;
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.accent} colors={[colors.accent]} />} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ padding: 16, paddingBottom: 20 }}>
          <Logo />
        </View>
        {empty && <Text style={[styles.muted, { paddingHorizontal: 16 }]}>{t('home.empty')}</Text>}
        <ContinueShelf title={t('home.continue')} items={d.continueWatching} />
        <Shelf title={t('home.watchlist')} cards={d.watchlist ?? []} more={{ label: t('home.seeAll'), href: '/list/watchlist' }} />
        <Shelf title={t('home.recentlyAdded')} cards={d.recentlyAdded} />
        <Shelf title={t('home.movies')} cards={d.movies} />
        <Shelf title={t('home.shows')} cards={d.shows} />
        <Shelf title={t('home.favorites')} cards={d.favorites ?? []} more={{ label: t('home.seeAll'), href: '/list/favorites' }} />
      </ScrollView>
    </SafeAreaView>
  );
}
