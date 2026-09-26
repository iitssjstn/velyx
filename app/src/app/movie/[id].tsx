import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Artwork } from '../../components/media';
import { ErrorState, Loading, ProgressLine, styles } from '../../components/ui';
import { formatClock, formatRuntime, progressFraction } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';
import type { MovieDetail } from '../../lib/types';

export default function Movie() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'movie', id], queryFn: () => api.get<MovieDetail>(`/api/movies/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const facts = [m.year, formatRuntime(m.runtime), m.rating ? `★ ${m.rating.toFixed(1)}` : null].filter(Boolean).join(' · ');
  const resume = m.progress && !m.progress.completed && m.progress.positionSec > 0 ? m.progress : null;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Stack.Screen options={{ title: m.title }} />
      <Artwork path={m.backdropPath} size="w1280" style={{ width: '100%', aspectRatio: 16 / 9 }} />
      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <Artwork path={m.posterPath} size="w342" label={m.title} style={{ width: 96, height: 144, borderRadius: radius.md, marginTop: -64 }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.title} accessibilityRole="header">{m.title}</Text>
            {facts ? <Text style={styles.muted}>{facts}</Text> : null}
            {m.genres.length ? <Text style={styles.muted}>{m.genres.map((g) => g.name).join(', ')}</Text> : null}
          </View>
        </View>
        {resume && (
          <View style={{ gap: 6 }}>
            <ProgressLine fraction={progressFraction(resume)} />
            <Text style={styles.muted}>
              {formatClock(resume.positionSec)} / {formatClock(resume.durationSec)}
            </Text>
          </View>
        )}
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: 12 }}>
          <Text style={styles.muted}>{t('detail.playSoon')}</Text>
        </View>
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
      </View>
    </ScrollView>
  );
}
