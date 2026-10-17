import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DiscoverCard, useOpenDiscover } from '../../../components/Discover';
import { Artwork } from '../../../components/media';
import { SeasonPicker } from '../../../components/SeasonPicker';
import { TrailerButton } from '../../../components/TrailerButton';
import { DetailSkeleton } from '../../../components/Skeleton';
import { Button, ErrorState, styles } from '../../../components/ui';
import { errorMessage } from '../../../lib/connection';
import { canRequestTitle, openSeasons, type SeerrDetails, type SeerrResult } from '../../../lib/discover';
import { useSession } from '../../../lib/session';
import { colors, radius } from '../../../lib/theme';

/** A movie or show from the catalog on a page of its own: what it is, who is in it, requesting it (or playing it), and titles like it. */
export default function RequestScreen() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const q = useQuery({ queryKey: [serverUrl, 'seerr', mediaType, id], queryFn: () => api.get<SeerrDetails>(`/api/seerr/${mediaType}/${Number(id)}`) });
  const similar = useQuery({ queryKey: [serverUrl, 'seerr', mediaType, id, 'similar'], queryFn: () => api.get<{ results?: SeerrResult[] }>(`/api/seerr/${mediaType}/${Number(id)}/recommendations`), enabled: q.isSuccess });
  const [picking, setPicking] = useState(false);
  const { open, busy } = useOpenDiscover();
  const requested = (title: string) => Alert.alert('Vidalune', t('request.requested', { title }), [{ text: t('common.ok'), onPress: () => router.back() }]);
  // A movie as a whole; a show's seasons are asked for in the season picker.
  const request = useMutation({
    mutationFn: () => api.post<{ title: string }>('/api/seerr/requests', { mediaType, tmdbId: Number(id), seasons: null }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: [serverUrl, 'discover'] });
      void qc.invalidateQueries({ queryKey: [serverUrl, 'seerr'] });
      requested(r.title);
    },
    onError: (err) => Alert.alert(t('common.error'), errorMessage(err, t)),
  });
  if (q.isLoading) return <DetailSkeleton wide={false} />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  // Only seasons never asked for (or turned down) can be ticked.
  const all = openSeasons(d);
  const facts = [d.mediaType === 'movie' ? t('request.movie') : t('request.show'), d.year, d.runtime ? t('request.minutes', { n: d.runtime }) : null, d.rating ? `★ ${d.rating.toFixed(1)}` : null, d.genres.join(', ') || null].filter(Boolean).join(' · ');
  const requestable = canRequestTitle(d);
  const isShow = d.mediaType === 'tv' && d.seasons.length > 0;
  // First a question; only "Request" there sends it to Seerr. A show's seasons are chosen in it.
  const confirm = () => {
    if (isShow) {
      setPicking(true);
      return;
    }
    Alert.alert(t('request.confirmTitle', { title: d.title }), t('request.confirmMovie'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('request.request'), onPress: () => request.mutate() },
    ]);
  };
  const cast = d.cast ?? [];
  const alike = similar.data?.results ?? [];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      {d.backdropPath ? <Artwork path={d.backdropPath} size="w780" label="" style={{ width: '100%', height: 200 }} /> : null}
      <View style={{ padding: 16, gap: 16, marginTop: d.backdropPath ? -60 : 0 }}>
      <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-end' }}>
        <Artwork path={d.posterPath} size="w342" label={d.title} style={{ width: 120, height: 180, borderRadius: radius.md }} />
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={styles.title}>{d.title}</Text>
          {d.tagline ? <Text style={[styles.muted, { fontStyle: 'italic' }]}>{d.tagline}</Text> : null}
          <Text style={styles.muted}>{facts}</Text>
          {d.inLibrary ? (
            <Text style={{ color: colors.ok, fontSize: 14 }}>{t('discover.inLibrary')}</Text>
          ) : d.state ? (
            <Text style={{ color: colors.accent, fontSize: 14 }}>{t(`request.state.${d.state}`)}</Text>
          ) : null}
        </View>
      </View>
      {d.overview ? <Text style={styles.body}>{d.overview}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {d.local && <Button label={t('player.play')} busy={busy} onPress={() => void open(d)} />}
        <TrailerButton type={d.mediaType === 'movie' ? 'movie' : 'show'} id={d.tmdbId} outsideLibrary />
      </View>
      {requestable && (
        <Button label={t('request.request')} busy={request.isPending} onPress={confirm} />
      )}
      {isShow && (
        // What there is, and what was asked for before; the seasons to request are chosen after "Request".
        <View style={{ gap: 4 }}>
          <Text style={styles.label}>{t('request.seasons')}</Text>
          {d.seasons.map((s) => (
            <View key={s.seasonNumber} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
              <Text style={[styles.body, { flex: 1 }]}>{t('request.season', { n: s.seasonNumber, count: s.episodeCount })}</Text>
              {!all.includes(s.seasonNumber) && s.state ? <Text style={{ color: s.state === 'available' ? colors.ok : colors.accent, fontSize: 12 }}>{t(`request.state.${s.state}`)}</Text> : null}
            </View>
          ))}
        </View>
      )}
      {isShow && <SeasonPicker details={d} visible={picking} onClose={() => setPicking(false)} onRequested={requested} />}
      {cast.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>{t('request.cast')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {cast.map((c) => (
              <View key={`${c.id}-${c.character ?? ''}`} style={{ width: 88, alignItems: 'center', gap: 4 }}>
                <Artwork path={c.profilePath} size="w185" label={c.name} style={{ width: 72, height: 72, borderRadius: 36 }} />
                <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 12, textAlign: 'center' }}>{c.name}</Text>
                {c.character ? <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 11, textAlign: 'center' }}>{c.character}</Text> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      )}
      {alike.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>{t('request.similar')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {alike.map((item) => (
              <DiscoverCard key={`${item.mediaType}-${item.tmdbId}`} item={item} width={112} onPress={() => void open(item)} />
            ))}
          </ScrollView>
        </View>
      )}
      </View>
    </ScrollView>
  );
}
