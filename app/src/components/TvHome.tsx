import { useRef, useState, type ReactNode } from 'react';
import { FlatList, Image as RNImage, Pressable, ScrollView, Text, View, useWindowDimensions, type PressableProps } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Artwork, openCard } from './media';
import { useOpenDiscover } from './Discover';
import { useTvFocus } from './useTvFocus';
import { DISCOVER_ROWS, discoverPath, mergePages, type DiscoverPage, type DiscoverRow, type SeerrResult } from '../lib/discover';
import { cardTile, discoverTile, heroPick, rowScroll, tvPosterWidth, type TvTile } from '../lib/tvHome';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import type { Card, ContinueItem, HomeData } from '../lib/types';

const SIDE = 48;
const GAP = 20;
/** The chosen poster or card grows a little, so it is easy to see where you are. */
const FOCUS_SCALE = 1.1;

/** A Pressable that knows it has the focus, for posters and buttons that change look when chosen. */
function Focusable({ children, ...props }: Omit<PressableProps, 'children'> & { children: (focused: boolean) => ReactNode }) {
  const [focused, setFocused] = useState(false);
  const tvFocus = useTvFocus();
  return (
    <Pressable
      hasTVPreferredFocus={tvFocus.preferred}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        tvFocus.remember();
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
    >
      {children(focused)}
    </Pressable>
  );
}

/** Dark shading over artwork, so text on it stays readable (the website's hero gradients). */
function Shade({ side, height = '60%' }: { side: 'left' | 'bottom'; height?: `${number}%` }) {
  return side === 'left' ? (
    <RNImage source={require('../../assets/fade-side.png')} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '75%', height: '100%' }} />
  ) : (
    <RNImage source={require('../../assets/fade.png')} resizeMode="stretch" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', height, transform: [{ scaleY: -1 }] }} />
  );
}

function HeroButton({ label, icon, primary, onPress, onFocus }: { label: string; icon: 'play' | 'info'; primary?: boolean; onPress: () => void; onFocus: () => void }) {
  return (
    <Focusable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onFocus={onFocus}>
      {(focused) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 46,
            paddingHorizontal: 22,
            borderRadius: radius.sm,
            backgroundColor: primary ? colors.accent : 'rgba(236,232,244,0.12)',
            borderWidth: 2,
            borderColor: focused ? colors.ink : 'transparent',
            transform: [{ scale: focused ? 1.05 : 1 }],
          }}
        >
          <Feather name={icon} size={18} color={primary ? colors.accentInk : colors.ink} />
          <Text style={{ color: primary ? colors.accentInk : colors.ink, fontSize: 16, fontWeight: '700' }}>{label}</Text>
        </View>
      )}
    </Focusable>
  );
}

function openContinueDetails(item: ContinueItem) {
  if (item.type === 'movie') router.push(`/movie/${item.id}`);
  else if (item.showId) router.push(`/show/${item.showId}`);
}

/** The website's hero: where you left off (or the newest title) over its artwork, with Play and Details. */
function Hero({ data, onFocus }: { data: HomeData; onFocus: () => void }) {
  const { t } = useSession();
  const { height } = useWindowDimensions();
  const pick = heroPick(data);
  if (!pick) return null;
  const cw = pick.kind === 'continue' ? pick.item : null;
  const card = pick.kind === 'card' ? pick.card : null;
  const title = cw ? cw.title : card!.title;
  const backdrop = cw ? (cw.imagePath ?? cw.posterPath) : (card!.backdropPath ?? card!.posterPath);
  const detail = cw ? [cw.subtitle, cw.episodeTitle].filter(Boolean).join(' · ') : (card!.overview ?? '');
  const show = card?.type === 'show';
  const play = () => (cw ? router.push(`/play/${cw.type}/${cw.id}`) : card!.type === 'movie' ? router.push(`/play/movie/${card!.id}`) : openCard(card!));
  return (
    <View style={{ height: Math.round(height * 0.62), backgroundColor: colors.surface }}>
      <Artwork path={backdrop} size="w1280" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.9 }} />
      <Shade side="left" />
      <Shade side="bottom" />
      <View style={{ position: 'absolute', left: SIDE, bottom: 28, width: '55%' }}>
        <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '700' }}>{cw ? t('home.pickUp') : t('home.recentlyAdded')}</Text>
        <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 42, lineHeight: 44, fontWeight: '700', marginTop: 6 }}>{title}</Text>
        {detail ? <Text numberOfLines={2} style={{ color: 'rgba(236,232,244,0.85)', fontSize: 16, lineHeight: 22, marginTop: 10 }}>{detail}</Text> : null}
        {cw && cw.percent > 0 && (
          <View style={{ height: 4, width: 260, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 12, overflow: 'hidden' }}>
            <View style={{ height: 4, width: `${Math.round(cw.percent)}%`, backgroundColor: colors.accent }} />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
          <HeroButton primary label={t('player.play')} icon="play" onPress={play} onFocus={onFocus} />
          {!show && <HeroButton label={t('home.details')} icon="info" onPress={() => (cw ? openContinueDetails(cw) : openCard(card!))} onFocus={onFocus} />}
        </View>
      </View>
    </View>
  );
}

/** A poster as on the website: a ring in the accent colour when chosen, with its details over it. */
function Poster({ tile, width, onPress, onFocus }: { tile: TvTile; width: number; onPress: () => void; onFocus: () => void }) {
  return (
    <Focusable accessibilityRole="button" accessibilityLabel={tile.title} onPress={onPress} onFocus={onFocus} style={{ width }}>
      {(focused) => (
        <>
          <View style={{ width, height: width * 1.5, borderRadius: radius.md, overflow: 'hidden', borderWidth: 3, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.05)', transform: [{ scale: focused ? FOCUS_SCALE : 1 }] }}>
            <Artwork path={tile.poster} size="w342" label={tile.title} style={{ width: '100%', height: '100%' }} />
            {focused && (
              <>
                <Shade side="bottom" height="75%" />
                <View style={{ position: 'absolute', left: 10, right: 10, bottom: tile.progress > 0 ? 16 : 10 }}>
                  <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>{tile.title}</Text>
                  {tile.facts ? <Text style={{ color: 'rgba(236,232,244,0.8)', fontSize: 12, marginTop: 3 }}>{tile.facts}</Text> : null}
                  {tile.rating ? <Text style={{ color: 'rgba(236,232,244,0.8)', fontSize: 12, marginTop: 2 }}>★ {tile.rating.toFixed(1)}</Text> : null}
                  {tile.genres ? <Text numberOfLines={1} style={{ color: 'rgba(236,232,244,0.65)', fontSize: 12, marginTop: 2 }}>{tile.genres}</Text> : null}
                </View>
              </>
            )}
            {tile.badge && (
              <Text numberOfLines={1} style={{ position: 'absolute', top: 6, right: 6, maxWidth: width - 12, backgroundColor: 'rgba(20,18,28,0.85)', color: colors.accent, fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' }}>{tile.badge}</Text>
            )}
            {tile.progress > 0 && (
              <View style={{ position: 'absolute', left: 8, right: 8, bottom: 6, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
                <View style={{ height: 3, width: `${Math.round(tile.progress * 100)}%`, backgroundColor: colors.accent }} />
              </View>
            )}
          </View>
          <Text numberOfLines={1} style={{ color: focused ? colors.ink : 'rgba(236,232,244,0.9)', fontSize: 14, fontWeight: '500', marginTop: 8 }}>{tile.title}</Text>
          <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 12 }}>{tile.sub || ' '}</Text>
        </>
      )}
    </Focusable>
  );
}

/** Continue Watching as on the website: wide artwork with progress, title and episode underneath. */
function ContinueCard({ item, onFocus }: { item: ContinueItem; onFocus: () => void }) {
  const { t } = useSession();
  const width = 300;
  return (
    <Focusable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => router.push(`/play/${item.type}/${item.id}`)} onFocus={onFocus} style={{ width }}>
      {(focused) => (
        <>
          <View style={{ width, height: width * 0.5625, borderRadius: radius.md, overflow: 'hidden', borderWidth: 3, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.05)', transform: [{ scale: focused ? FOCUS_SCALE : 1 }] }}>
            <Artwork path={item.imagePath ?? item.posterPath} size="w780" label={item.title} style={{ width: '100%', height: '100%' }} />
            <Shade side="bottom" height="50%" />
            {focused && (
              <View style={{ position: 'absolute', left: 12, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 12, height: 30 }}>
                <Feather name="play" size={14} color={colors.bg} />
                <Text style={{ color: colors.bg, fontSize: 13, fontWeight: '700' }}>{t('player.play')}</Text>
              </View>
            )}
            {item.percent > 0 && (
              <View style={{ position: 'absolute', left: 10, right: 10, bottom: 8, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
                <View style={{ height: 3, width: `${Math.round(item.percent)}%`, backgroundColor: colors.accent }} />
              </View>
            )}
          </View>
          <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 14, fontWeight: '500', marginTop: 8 }}>{item.title}</Text>
          {item.subtitle ? (
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
              {item.upNext ? `${t('home.upNext')} · ` : ''}
              {item.subtitle}
              {item.episodeTitle ? ` · ${item.episodeTitle}` : ''}
            </Text>
          ) : null}
        </>
      )}
    </Focusable>
  );
}

function Row<T>({ title, items, keyOf, render, onEndReached }: { title: string; items: T[]; keyOf: (x: T) => string; render: (x: T, i: number) => ReactNode; onEndReached?: () => void }) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: 28 }}>
      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '700', marginBottom: 12, paddingHorizontal: SIDE }}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={keyOf}
        renderItem={({ item, index }) => <>{render(item, index)}</>}
        initialNumToRender={8}
        windowSize={5}
        onEndReached={onEndReached}
        onEndReachedThreshold={2}
        // Room around the chosen poster, which grows.
        contentContainerStyle={{ paddingHorizontal: SIDE, paddingVertical: 14, gap: GAP }}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

function DiscoverTvRow({ spec, width, onFocus, onOpen }: { spec: DiscoverRow; width: number; onFocus: () => void; onOpen: (item: SeerrResult) => void }) {
  const { api, t, serverUrl } = useSession();
  const q = useInfiniteQuery({
    queryKey: [serverUrl, 'discover', spec.row, spec.genre ?? null],
    queryFn: ({ pageParam }) => api.get<DiscoverPage>(discoverPath(spec, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 60_000,
  });
  const items = mergePages(q.data?.pages ?? []);
  const title = spec.genreName ? t(spec.title, { genre: t(spec.genreName) }) : t(spec.title);
  return (
    <Row
      title={title}
      items={items}
      keyOf={(x) => `${x.mediaType}-${x.tmdbId}`}
      render={(x) => <Poster tile={discoverTile(x, t)} width={width} onFocus={onFocus} onPress={() => onOpen(x)} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
    />
  );
}

/**
 * The home screen on a TV, built like the website's: the hero at the top, then the rows. The row
 * with the focus moves to the middle of the screen, so it is never half in view.
 */
export function TvHome({ data }: { data: HomeData }) {
  const { api, t, serverUrl } = useSession();
  const { height } = useWindowDimensions();
  const width = tvPosterWidth(height);
  const scroll = useRef<ScrollView>(null);
  const tops = useRef(new Map<string, { y: number; height: number }>());
  const active = useRef('hero');
  const [rows, setRows] = useState(3);
  const seerr = useQuery({ queryKey: [serverUrl, 'seerr'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const { open } = useOpenDiscover();

  const view = useRef(0);
  const toActive = () => {
    const at = tops.current.get(active.current);
    const y = active.current === 'hero' || !at ? 0 : rowScroll(at.y, at.height, view.current);
    scroll.current?.scrollTo({ y, animated: true });
  };
  const focusRow = (key: string, discoverIndex?: number) => () => {
    if (discoverIndex !== undefined && discoverIndex >= rows - 2) setRows((n) => Math.max(n, discoverIndex + 3));
    if (active.current === key) return;
    active.current = key;
    toActive();
  };
  const section = (key: string, node: ReactNode) => (
    <View
      key={key}
      onLayout={(e) => {
        tops.current.set(key, { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height });
        if (key === active.current) toActive();
      }}
    >
      {node}
    </View>
  );
  const cards = (key: string, title: string, list: Card[]) =>
    section(key, <Row title={title} items={list} keyOf={(c) => `${c.type}-${c.id}`} render={(c) => <Poster tile={cardTile(c, t)} width={width} onFocus={focusRow(key)} onPress={() => openCard(c)} />} />);

  const d = data;
  return (
    <ScrollView ref={scroll} onLayout={(e) => (view.current = e.nativeEvent.layout.height)} contentContainerStyle={{ paddingBottom: height / 2 }}>
      {section('hero', <Hero data={d} onFocus={focusRow('hero')} />)}
      {section('continue', <Row title={t('home.continue')} items={d.continueWatching} keyOf={(c) => `${c.type}-${c.id}`} render={(c) => <ContinueCard item={c} onFocus={focusRow('continue')} />} />)}
      {cards('watchlist', t('home.watchlist'), d.watchlist ?? [])}
      {cards('recent', t('home.recentlyAdded'), d.recentlyAdded)}
      {cards('movies', t('home.movies'), d.movies)}
      {cards('shows', t('home.shows'), d.shows)}
      {cards('favorites', t('home.favorites'), d.favorites ?? [])}
      {seerr.data?.enabled &&
        DISCOVER_ROWS.slice(0, rows).map((spec, i) => {
          const key = `discover-${spec.row}-${spec.genre ?? ''}`;
          return section(key, <DiscoverTvRow spec={spec} width={width} onFocus={focusRow(key, i)} onOpen={(item) => void open(item)} />);
        })}
    </ScrollView>
  );
}
