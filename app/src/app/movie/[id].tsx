import { RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Toggle } from '../../components/actions';
import { TrailerButton } from '../../components/TrailerButton';
import { Artwork, useWide } from '../../components/media';
import { DetailSkeleton } from '../../components/Skeleton';
import { Button, ErrorState, ProgressLine, styles } from '../../components/ui';
import { formatClock, formatRuntime, progressFraction } from '../../lib/format';
import { savedRequest, watchedRequest } from '../../lib/lists';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';
import type { MovieDetail } from '../../lib/types';

export default function Movie() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, t, serverUrl } = useSession();
  const wide = useWide();
  const { width } = useWindowDimensions();
  const q = useQuery({ queryKey: [serverUrl, 'movie', id], queryFn: () => api.get<MovieDetail>(`/api/movies/${id}`) });
  if (q.isLoading) return <DetailSkeleton wide={wide} />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const facts = [m.year, formatRuntime(m.runtime), m.rating ? `★ ${m.rating.toFixed(1)}` : null].filter(Boolean).join(' · ');
  const resume = m.progress && !m.progress.completed && m.progress.positionSec > 0 ? m.progress : null;

  const play = m.files.length ? (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Button label={resume ? t('player.resume', { time: formatClock(resume.positionSec) }) : t('player.play')} onPress={() => router.push(`/play/movie/${m.id}`)} />
      {resume && <Button label={t('player.fromStart')} variant="ghost" onPress={() => router.push(`/play/movie/${m.id}?t=0`)} />}
      <TrailerButton type="movie" id={m.id} />
    </View>
  ) : (
    <View style={{ flexDirection: 'row' }}>
      <TrailerButton type="movie" id={m.id} />
    </View>
  );
  const toggles = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Toggle active={m.watchlist} icon="bookmark" text={t('actions.watchlist')} label={t('actions.addWatchlist')} activeLabel={t('actions.removeWatchlist')} request={(on) => savedRequest('watchlist', 'movie', m.id, on)} />
      <Toggle active={m.favorite} icon="heart" text={t('actions.favorite')} label={t('actions.addFavorite')} activeLabel={t('actions.removeFavorite')} request={(on) => savedRequest('favorites', 'movie', m.id, on)} />
      <Toggle active={Boolean(m.progress?.completed)} icon="check" text={t('actions.watched')} label={t('actions.markWatched')} activeLabel={t('actions.markUnwatched')} request={(on) => watchedRequest({ movieId: m.id }, on)} />
    </View>
  );
  const heading = (
    <View style={{ gap: 4 }}>
      <Text style={styles.title} accessibilityRole="header">{m.title}</Text>
      {facts ? <Text style={styles.muted}>{facts}</Text> : null}
      {m.genres.length ? <Text style={styles.muted}>{m.genres.map((g) => g.name).join(', ')}</Text> : null}
    </View>
  );
  const progress = resume && (
    <View style={{ gap: 6, maxWidth: 480 }}>
      <ProgressLine fraction={progressFraction(resume)} />
      <Text style={styles.muted}>
        {formatClock(resume.positionSec)} / {formatClock(resume.durationSec)}
      </Text>
    </View>
  );
  const about = (
    <>
      {m.tagline ? <Text style={[styles.body, { fontStyle: 'italic', color: colors.muted }]}>{m.tagline}</Text> : null}
      {m.overview ? <Text style={styles.body}>{m.overview}</Text> : null}
      {m.director ? (
        <Text style={styles.muted}>
          {t('detail.director')}: <Text style={{ color: colors.ink }}>{m.director}</Text>
        </Text>
      ) : null}
      {m.cast.length ? (
        <Text style={styles.muted}>
          {t('detail.cast')}: <Text style={{ color: colors.ink }}>{m.cast.slice(0, 8).map((p) => p.name).join(', ')}</Text>
        </Text>
      ) : null}
    </>
  );

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
    >
      <Stack.Screen options={{ title: m.title }} />
      {/* On a tablet the backdrop is a band, not a full 16:9 picture that pushes everything down. */}
      <Artwork path={m.backdropPath} size="w1280" style={{ width: '100%', height: wide ? Math.min(360, width * 0.3) : width * 0.5625 }} />
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 24, padding: 24 }}>
          <Artwork path={m.posterPath} size="w500" label={m.title} style={{ width: 200, height: 300, borderRadius: radius.lg, marginTop: -96 }} />
          <View style={{ flex: 1, gap: 16, maxWidth: 760 }}>
            {heading}
            {progress}
            {play}
            {toggles}
            {about}
          </View>
        </View>
      ) : (
        <View style={{ padding: 16, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <Artwork path={m.posterPath} size="w342" label={m.title} style={{ width: 96, height: 144, borderRadius: radius.md, marginTop: -64 }} />
            <View style={{ flex: 1 }}>{heading}</View>
          </View>
          {progress}
          {play}
          {toggles}
          {about}
        </View>
      )}
    </ScrollView>
  );
}
