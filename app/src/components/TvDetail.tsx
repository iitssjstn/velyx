import { useState, type ReactNode } from 'react';
import { FlatList, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Artwork } from './media';
import { Focusable, SIDE, Shade } from './TvHome';
import { Lift } from './ui';
import { aboutFacts, episodeFacts, initials, startEpisode } from '../lib/tvDetail';
import { useSession } from '../lib/session';
import { progressFraction } from '../lib/format';
import { colors, radius } from '../lib/theme';
import type { EpisodeSummary, Person } from '../lib/types';

const STILL = 300;
const TEXT_SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };

/**
 * A title's page on a TV (the owner's design): the artwork bright on the right, running into the
 * background on the left; there a big title with its year, the facts, the buttons in one row (Watchlist,
 * Favorite and Watched as round icons) and the story. `above` goes over the buttons (progress),
 * `children` are the buttons, `below` is what follows (a show's seasons and episodes, then About
 * with the cast at the bottom).
 */
export function TvDetail({ backdrop, title, year, facts, overview, above, children, below }: { backdrop: string | null; title: string; year?: number | null; facts: string; overview: string | null; above?: ReactNode; children: ReactNode; below?: ReactNode }) {
  const { height } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Artwork path={backdrop} size="w1280" style={{ position: 'absolute', left: '30%', top: 0, right: 0, height }} />
      <Shade side="left" from="30%" width="45%" />
      <Shade side="bottom" height="45%" />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* The text keeps to the left 60 %; the buttons may run further, so they stay on one row. */}
        <View style={{ minHeight: below ? height * 0.6 : height, justifyContent: 'flex-end', paddingHorizontal: SIDE, paddingTop: 56, paddingBottom: 24, gap: 14 }}>
          <Text accessibilityRole="header" numberOfLines={2} style={{ color: colors.ink, fontSize: 52, lineHeight: 58, fontWeight: '700', letterSpacing: -1, maxWidth: '60%', ...TEXT_SHADOW }}>
            {title}
            {year ? <Text style={{ fontWeight: '300', color: 'rgba(236,232,244,0.6)' }}> ({year})</Text> : null}
          </Text>
          {facts ? <Text style={{ color: colors.muted, fontSize: 17, maxWidth: '60%', ...TEXT_SHADOW }}>{facts}</Text> : null}
          {above ? <View style={{ maxWidth: '60%' }}>{above}</View> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 4 }}>{children}</View>
          {overview ? <Text numberOfLines={4} style={{ color: 'rgba(236,232,244,0.88)', fontSize: 17, lineHeight: 25, maxWidth: '60%', ...TEXT_SHADOW }}>{overview}</Text> : null}
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
              // The chosen season filled in grey-purple, the others outlined; white edge on the focus.
              <View style={{ paddingHorizontal: 18, height: 40, borderRadius: radius.md, justifyContent: 'center', backgroundColor: on ? colors.button : 'transparent', borderWidth: 2, borderColor: focused ? colors.ink : on ? 'transparent' : colors.outline, transform: [{ scale: focused ? 1.06 : 1 }] }}>
                <Text style={{ color: on ? colors.buttonInk : colors.muted, fontSize: 15, fontWeight: '600' }}>{x.name}</Text>
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
        // Room for the chosen still, which rises with its glow under it.
        contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: 16, paddingBottom: 30, gap: 20 }}
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
                <Lift focused={focused} scale={1.08}>
                <View style={{ width: STILL, height: STILL * 0.5625, borderRadius: radius.md, overflow: 'hidden', borderWidth: 3, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.05)' }}>
                  <Artwork path={e.stillPath} size="w500" label={label(e)} style={{ width: '100%', height: '100%', borderRadius: radius.md - 3 }} />
                  {e.progress && !e.progress.completed && progressFraction(e.progress) > 0 ? (
                    <View style={{ position: 'absolute', left: 10, right: 10, bottom: 8, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
                      <View style={{ height: 3, width: `${Math.round(progressFraction(e.progress) * 100)}%`, backgroundColor: colors.accent }} />
                    </View>
                  ) : null}
                </View>
                </Lift>
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

const FACE = 140;

/**
 * The "About" block at the bottom of a TV detail page: the whole story, genres and who made it, and
 * under it the cast as cards with photo and name (always at the very bottom, for a movie and a show).
 * Both parts can take the focus, so the arrows reach them.
 */
export function TvAbout({ detail, overview, tagline, cast }: { detail: Parameters<typeof aboutFacts>[0]; overview: string | null; tagline?: string | null; cast: Person[] }) {
  const { t } = useSession();
  const facts = aboutFacts(detail, t);
  if (!overview && !facts.length && !cast.length) return null;
  return (
    <View style={{ marginTop: 32, gap: 16 }}>
      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '700', paddingHorizontal: SIDE }}>{t('detail.about')}</Text>
      <View style={{ paddingHorizontal: SIDE - 14 }}>
        <Focusable accessibilityRole="text">
          {(focused) => (
            <View style={{ padding: 22, borderRadius: radius.lg, borderWidth: 2, borderColor: focused ? colors.ink : 'transparent', backgroundColor: colors.surface, flexDirection: 'row', gap: 48, maxWidth: 1400 }}>
              <View style={{ flex: 3, gap: 8 }}>
                {tagline ? <Text style={{ color: colors.muted, fontSize: 16, fontStyle: 'italic' }}>{tagline}</Text> : null}
                {overview ? <Text style={{ color: 'rgba(236,232,244,0.9)', fontSize: 16, lineHeight: 24 }}>{overview}</Text> : null}
              </View>
              {facts.length > 0 && (
                <View style={{ flex: 2, gap: 10 }}>
                  {facts.map((f) => (
                    <Text key={f.label} style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
                      {f.label}: <Text style={{ color: colors.ink }}>{f.value}</Text>
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}
        </Focusable>
      </View>
      {cast.length > 0 && (
        <View>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', paddingHorizontal: SIDE }}>{t('detail.cast')}</Text>
          <FlatList
            horizontal
            data={cast.slice(0, 30)}
            keyExtractor={(p, i) => `${p.id ?? p.name}-${i}`}
            contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: 16, paddingBottom: 30, gap: 20 }}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item: p }) => (
              <Focusable accessibilityRole="text" accessibilityLabel={p.role ? `${p.name}, ${p.role}` : p.name} style={{ width: FACE }}>
                {(focused) => (
                  // A standing card: the photo with name and role under it, rising with its glow when chosen.
                  <Lift focused={focused} scale={1.06}>
                    <View style={{ width: FACE, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 3, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.05)' }}>
                      <View style={{ width: '100%', height: Math.round(FACE * 1.3), backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
                        {p.profilePath ? <Artwork path={p.profilePath} size="w185" style={{ width: '100%', height: '100%' }} /> : <Text style={{ color: colors.muted, fontSize: 34, fontWeight: '700' }}>{initials(p.name)}</Text>}
                      </View>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
                        <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>{p.name}</Text>
                        <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 12 }}>{p.role || ' '}</Text>
                      </View>
                    </View>
                  </Lift>
                )}
              </Focusable>
            )}
          />
        </View>
      )}
    </View>
  );
}
