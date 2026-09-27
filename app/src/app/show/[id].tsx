import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Toggle } from '../../components/actions';
import { Artwork } from '../../components/media';
import { savedRequest, watchedRequest } from '../../lib/lists';
import { Button, ErrorState, Loading, ProgressLine, styles } from '../../components/ui';
import { episodeCode, formatRuntime, progressFraction } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';
import type { SeasonDetail, ShowDetail } from '../../lib/types';

export default function Show() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'show', id], queryFn: () => api.get<ShowDetail>(`/api/shows/${id}`) });
  const [picked, setPicked] = useState<number | null>(null);
  const s = q.data;
  // The season you are in opens first (specials last), like on the website.
  const seasons = s ? [...s.seasons].sort((a, b) => (a.seasonNumber === 0 ? 1 : b.seasonNumber === 0 ? -1 : a.seasonNumber - b.seasonNumber)) : [];
  const current = picked ?? s?.upNext?.seasonNumber ?? seasons[0]?.seasonNumber ?? null;
  const season = useQuery({
    queryKey: [serverUrl, 'show', id, 'season', current],
    enabled: current !== null,
    queryFn: () => api.get<SeasonDetail>(`/api/shows/${id}/seasons/${current}`),
  });
  const currentSeason = seasons.find((x) => x.seasonNumber === current) ?? null;
  if (q.isLoading) return <Loading />;
  if (q.error || !s) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const regular = s.seasons.filter((x) => x.seasonNumber > 0).length || s.seasons.length;
  const facts = [s.year, s.network, regular === 1 ? t('show.season') : t('show.seasons', { n: regular }), t('show.episodes', { n: s.episodeCount })].filter(Boolean).join(' · ');
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Stack.Screen options={{ title: s.title }} />
      <Artwork path={s.backdropPath} size="w1280" style={{ width: '100%', aspectRatio: 16 / 9 }} />
      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <Artwork path={s.posterPath} size="w342" label={s.title} style={{ width: 96, height: 144, borderRadius: radius.md, marginTop: -64 }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.title} accessibilityRole="header">{s.title}</Text>
            <Text style={styles.muted}>{facts}</Text>
            {s.watchedCount > 0 && <Text style={styles.muted}>{t('show.watched', { watched: s.watchedCount, total: s.episodeCount })}</Text>}
          </View>
        </View>
        {s.upNext && (
          <View style={{ flexDirection: 'row' }}>
            <Button label={t('show.continue', { code: episodeCode(s.upNext.seasonNumber, s.upNext.episodeNumber) })} onPress={() => router.push(`/play/episode/${s.upNext!.id}`)} />
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Toggle active={s.watchlist} icon="bookmark" text={t('actions.watchlist')} label={t('actions.addWatchlist')} activeLabel={t('actions.removeWatchlist')} request={(on) => savedRequest('watchlist', 'show', s.id, on)} />
          <Toggle active={s.favorite} icon="heart" text={t('actions.favorite')} label={t('actions.addFavorite')} activeLabel={t('actions.removeFavorite')} request={(on) => savedRequest('favorites', 'show', s.id, on)} />
          <Toggle
            active={s.episodeCount > 0 && s.watchedCount >= s.episodeCount}
            icon="check"
            text={t('actions.watched')}
            label={t('actions.showWatched')}
            activeLabel={t('actions.showUnwatched')}
            request={(on) => watchedRequest({ showId: s.id }, on)}
          />
        </View>
        {s.overview ? <Text style={styles.body}>{s.overview}</Text> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} accessibilityRole="tablist">
        {seasons.map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: x.seasonNumber === current }}
            onPress={() => setPicked(x.seasonNumber)}
            style={{ paddingHorizontal: 14, height: 36, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: x.seasonNumber === current ? colors.accent : colors.raised }}
          >
            <Text style={{ color: x.seasonNumber === current ? colors.accentInk : colors.ink, fontWeight: '600' }}>{x.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ padding: 16, gap: 16 }}>
        {currentSeason && (
          <View style={{ flexDirection: 'row' }}>
            <Toggle
              active={currentSeason.episodeCount > 0 && currentSeason.watchedCount >= currentSeason.episodeCount}
              icon="check"
              text={t('actions.watched')}
              label={t('actions.seasonWatched')}
              activeLabel={t('actions.seasonUnwatched')}
              request={(on) => watchedRequest({ seasonId: currentSeason.id }, on)}
            />
          </View>
        )}
        {season.isLoading && <Loading />}
        {season.data?.episodes.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            accessibilityLabel={`${t('player.play')} ${episodeCode(e.seasonNumber, e.episodeNumber)}${e.title ? ` ${e.title}` : ''}`}
            // A watched episode starts over; one in progress resumes.
            onPress={() => router.push(`/play/episode/${e.id}${e.progress?.completed ? '?t=0' : ''}`)}
            style={({ pressed }) => ({ flexDirection: 'row', gap: 12, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ width: 140 }}>
              <Artwork path={e.stillPath} size="w500" label={episodeCode(e.seasonNumber, e.episodeNumber)} style={{ width: 140, height: 79, borderRadius: radius.sm }} />
              {e.progress && !e.progress.completed ? (
                <View style={{ marginTop: 3 }}>
                  <ProgressLine fraction={progressFraction(e.progress)} />
                </View>
              ) : null}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.ink, fontWeight: '600' }} numberOfLines={2}>
                {episodeCode(e.seasonNumber, e.episodeNumber)}
                {e.title ? ` · ${e.title}` : ''}
              </Text>
              <Text style={styles.muted}>
                {formatRuntime(e.runtime ?? (e.durationSec ? Math.round(e.durationSec / 60) : null))}
              </Text>
              {e.overview ? <Text style={styles.muted} numberOfLines={2}>{e.overview}</Text> : null}
            </View>
            <View style={{ justifyContent: 'center' }}>
              <Toggle
                compact
                active={Boolean(e.progress?.completed)}
                icon="check"
                label={t('actions.episodeWatched', { code: episodeCode(e.seasonNumber, e.episodeNumber) })}
                activeLabel={t('actions.episodeUnwatched', { code: episodeCode(e.seasonNumber, e.episodeNumber) })}
                request={(on) => watchedRequest({ episodeId: e.id }, on)}
              />
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
