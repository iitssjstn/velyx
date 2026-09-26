import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ContinueShelf, Shelf } from '../../components/media';
import { ErrorState, Loading, styles } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';
import type { HomeData } from '../../lib/types';

export default function Home() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'home'], queryFn: () => api.get<HomeData>('/api/home') });
  if (q.isLoading) return <Loading />;
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
        <Shelf title={t('home.recentlyAdded')} cards={d.recentlyAdded} />
        <Shelf title={t('home.movies')} cards={d.movies} />
        <Shelf title={t('home.shows')} cards={d.shows} />
      </ScrollView>
    </SafeAreaView>
  );
}
