import { useState, type ReactNode } from 'react';
import { FlatList, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Artwork } from './media';
import { Focusable, SIDE, Shade } from './TvHome';
import { episodeFacts, startEpisode } from '../lib/tvDetail';
import { progressFraction } from '../lib/format';
import { colors, radius } from '../lib/theme';
import type { EpisodeSummary } from '../lib/types';

const STILL = 300;

/**
 * A title's page on a TV, in the style of the website's detail page: its artwork dimmed over the
 * whole screen, and on the left the title, facts, story and buttons. `children` are the buttons;
 * `below` is what follows (a show's seasons and episodes).
 */
export function TvDetail({ backdrop, title, facts, overview, children, below }: { backdrop: string | null; title: string; facts: string; overview: string | null; children: ReactNode; below?: ReactNode }) {
  const { height } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Artwork path={backdrop} size="w1280" style={{ position: 'absolute', left: 0, top: 0, right: 0, height, opacity: 0.55 }} />
      <Shade side="left" />
      <Shade side="bottom" height="70%" />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={{ minHeight: below ? height * 0.58 : height, justifyContent: 'flex-end', paddingHorizontal: SIDE, paddingTop: 48, paddingBottom: 24, width: '62%', gap: 12 }}>
          <Text accessibilityRole="header" numberOfLines={2} style={{ color: colors.ink, fontSize: 40, lineHeight: 44, fontWeight: '700' }}>{title}</Text>
          {facts ? <Text style={{ color: 'rgba(236,232,244,0.8)', fontSize: 16 }}>{facts}</Text> : null}
          {overview ? <Text numberOfLines={4} style={{ color: 'rgba(236,232,244,0.9)', fontSize: 16, lineHeight: 23 }}>{overview}</Text> : null}
          <View style={{ gap: 12, marginTop: 6 }}>{children}</View>
        </View>
        {below}
      </ScrollView>
    </View>
  );
}

/** A show's seasons as tabs, on a TV. */
export function TvSeasonTabs({ seasons, current, onPick }: { seasons: { id: number; seasonNumber: number; name: string }[]; current: number | null; onPick: (n: number) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SIDE, paddingVertical: 8, gap: 10 }} accessibilityRole="tablist">
      {seasons.map((x) => {
        const on = x.seasonNumber === current;
        return (
          <Focusable key={x.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onPick(x.seasonNumber)}>
            {(focused) => (
              <View style={{ paddingHorizontal: 18, height: 40, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: on ? colors.accent : 'rgba(236,232,244,0.12)', borderWidth: 2, borderColor: focused ? colors.ink : 'transparent', transform: [{ scale: focused ? 1.06 : 1 }] }}>
                <Text style={{ color: on ? colors.accentInk : colors.ink, fontSize: 15, fontWeight: '600' }}>{x.name}</Text>
              </View>
            )}
          </Focusable>
        );
      })}
    </ScrollView>
  );
}

/**
 * A season's episodes as one row of stills, on a TV; the story of the chosen episode shows
 * underneath. The row starts at the episode to watch next (give it a `key` per season).
 */
export function TvEpisodeRow({ episodes, upNextId, label }: { episodes: EpisodeSummary[]; upNextId: number | null; label: (e: EpisodeSummary) => string }) {
  const start = startEpisode(episodes, upNextId);
  const [chosen, setChosen] = useState<EpisodeSummary | null>(episodes[start] ?? null);
  return (
    <View>
      <FlatList
        horizontal
        data={episodes}
        keyExtractor={(e) => String(e.id)}
        getItemLayout={(_, index) => ({ length: STILL + 20, offset: SIDE + (STILL + 20) * index, index })}
        initialScrollIndex={start}
        contentContainerStyle={{ paddingHorizontal: SIDE, paddingVertical: 16, gap: 20 }}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item: e }) => (
          <Focusable
            accessibilityRole="button"
            accessibilityLabel={label(e)}
            // A watched episode starts over; one in progress resumes.
            onPress={() => router.push(`/play/episode/${e.id}${e.progress?.completed ? '?t=0' : ''}`)}
            onFocus={() => setChosen(e)}
            style={{ width: STILL }}
          >
            {(focused) => (
              <>
                <View style={{ width: STILL, height: STILL * 0.5625, borderRadius: radius.md, overflow: 'hidden', borderWidth: 3, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.05)', transform: [{ scale: focused ? 1.08 : 1 }] }}>
                  <Artwork path={e.stillPath} size="w500" label={label(e)} style={{ width: '100%', height: '100%' }} />
                  {e.progress && !e.progress.completed && progressFraction(e.progress) > 0 ? (
                    <View style={{ position: 'absolute', left: 10, right: 10, bottom: 8, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
                      <View style={{ height: 3, width: `${Math.round(progressFraction(e.progress) * 100)}%`, backgroundColor: colors.accent }} />
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={{ color: focused ? colors.ink : 'rgba(236,232,244,0.9)', fontSize: 15, fontWeight: '600', marginTop: 10 }}>{e.title ?? episodeFacts(e)}</Text>
                <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>
                  {episodeFacts(e)}
                  {e.progress?.completed ? ' · ✓' : ''}
                </Text>
              </>
            )}
          </Focusable>
        )}
      />
      {chosen?.overview ? <Text numberOfLines={3} style={{ color: 'rgba(236,232,244,0.85)', fontSize: 16, lineHeight: 23, paddingHorizontal: SIDE, maxWidth: 1000 }}>{chosen.overview}</Text> : null}
    </View>
  );
}
