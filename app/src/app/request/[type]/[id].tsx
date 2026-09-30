import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOpenDiscover } from '../../../components/Discover';
import { Artwork } from '../../../components/media';
import { DetailSkeleton } from '../../../components/Skeleton';
import { Button, ErrorState, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/connection';
import { canRequest, toggleSeason, type SeerrDetails } from '../../../lib/discover';
import { useSession } from '../../../lib/session';
import { colors, radius } from '../../../lib/theme';

/** A movie or show from the catalog that is not here (yet): what it is, and requesting it. */
export default function RequestScreen() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const q = useQuery({ queryKey: [serverUrl, 'seerr', mediaType, id], queryFn: () => api.get<SeerrDetails>(`/api/seerr/${mediaType}/${Number(id)}`) });
  const [chosen, setChosen] = useState<number[] | null>(null);
  const { open, busy } = useOpenDiscover();
  const request = useMutation({
    mutationFn: () => api.post<{ title: string }>('/api/seerr/requests', { mediaType, tmdbId: Number(id), seasons: mediaType === 'tv' ? chosen : null }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: [serverUrl, 'discover'] });
      void qc.invalidateQueries({ queryKey: [serverUrl, 'seerr'] });
      Alert.alert('Vidalune', t('request.requested', { title: r.title }), [{ text: t('common.ok'), onPress: () => router.back() }]);
    },
    onError: (err) => Alert.alert(t('common.error'), errorMessage(err, t)),
  });
  if (q.isLoading) return <DetailSkeleton wide={false} />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const all = d.seasons.map((s) => s.seasonNumber);
  const facts = [d.mediaType === 'movie' ? t('request.movie') : t('request.show'), d.year, d.runtime ? t('request.minutes', { n: d.runtime }) : null, d.genres.join(', ') || null].filter(Boolean).join(' · ');
  const requestable = canRequest(d);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Artwork path={d.posterPath} size="w342" label={d.title} style={{ width: 120, height: 180, borderRadius: radius.md }} />
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={styles.title}>{d.title}</Text>
          <Text style={styles.muted}>{facts}</Text>
          {d.inLibrary ? (
            <Text style={{ color: colors.ok, fontSize: 14 }}>{t('discover.inLibrary')}</Text>
          ) : d.state ? (
            <Text style={{ color: colors.accent, fontSize: 14 }}>{t(`request.state.${d.state}`)}</Text>
          ) : null}
        </View>
      </View>
      {d.overview ? <Text style={styles.body}>{d.overview}</Text> : null}
      {d.local && <Button label={t('player.play')} busy={busy} onPress={() => void open(d)} />}
      {requestable && d.mediaType === 'tv' && d.seasons.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.label}>{t('request.seasons')}</Text>
          {d.seasons.map((s) => {
            const on = chosen === null || chosen.includes(s.seasonNumber);
            return (
              <Pressable
                key={s.seasonNumber}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setChosen(toggleSeason(chosen, all, s.seasonNumber, !on))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
              >
                <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on && <Text style={{ color: colors.accentInk, fontWeight: '800', fontSize: 13 }}>✓</Text>}
                </View>
                <Text style={styles.body}>{t('request.season', { n: s.seasonNumber, count: s.episodeCount })}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {requestable && (
        <Button
          label={d.mediaType === 'movie' ? t('request.request') : chosen === null ? t('request.requestAll') : t('request.requestSeasons', { count: chosen.length })}
          busy={request.isPending}
          disabled={chosen !== null && chosen.length === 0}
          onPress={() => request.mutate()}
        />
      )}
    </ScrollView>
  );
}
