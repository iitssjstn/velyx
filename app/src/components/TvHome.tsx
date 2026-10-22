import { useRef, useState, type ReactNode } from 'react';
import { FlatList, Image as RNImage, Pressable, ScrollView, Text, View, useWindowDimensions, type PressableProps } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Artwork, openCard } from './media';
import { useOpenDiscover } from './Discover';
import { DISCOVER_ROWS, discoverPath, mergePages, type DiscoverPage, type DiscoverRow, type SeerrResult } from '../lib/discover';
import { cardTile, continueTile, discoverTile, genreTiles, heroPick, rowOffset, tvSizes, type TvTile } from '../lib/tvHome';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import type { Card, ContinueItem, HomeData } from '../lib/types';

type Sizes = ReturnType<typeof tvSizes>;
type Genre = { id: number; name: string; count: number };
/** Height of the facts under the row that has the focus. */
const INFO = 104;

/** A Pressable that knows it has the focus, for tiles and buttons that change look instead of getting a ring. */
function Focusable({ children, ...props }: Omit<PressableProps, 'children'> & { children: (focused: boolean) => ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...props}
      onFocus={(e) => {
        setFocused(true);
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

function TvButton({ label, icon, onPress, onFocus }: { label: string; icon?: 'play' | 'info'; onPress: () => void; onFocus?: () => void }) {
  return (
    <Focusable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onFocus={onFocus}>
      {(focused) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: focused ? colors.accent : 'rgba(236,232,244,0.16)' }}>
          {icon && <Feather name={icon} size={18} color={focused ? colors.accentInk : colors.ink} />}
          <Text style={{ color: focused ? colors.accentInk : colors.ink, fontSize: 16, fontWeight: '700' }}>{label}</Text>
        </View>
      )}
    </Focusable>
  );
}

/** Dark shading over artwork, so text on it stays readable. */
function Shade({ side }: { side: 'left' | 'bottom' }) {
  return side === 'left' ? (
    <RNImage source={require('../../assets/fade-side.png')} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '70%', height: '100%' }} />
  ) : (
    <RNImage source={require('../../assets/fade.png')} resizeMode="stretch" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', height: '55%', transform: [{ scaleY: -1 }] }} />
  );
}

function Hero({ data, sizes, onFocus }: { data: HomeData; sizes: Sizes; onFocus: () => void }) {
  const { t } = useSession();
  const { height } = useWindowDimensions();
  const pick = heroPick(data);
  if (!pick) return null;
  const tile = pick.kind === 'continue' ? continueTile(pick.item, t) : cardTile(pick.card, t);
  const play = () => (pick.kind === 'continue' ? router.push(`/play/${pick.item.type}/${pick.item.id}`) : pick.card.type === 'movie' ? router.push(`/play/movie/${pick.card.id}`) : openCard(pick.card));
  const info = () => (pick.kind === 'continue' ? openContinueDetails(pick.item) : openCard(pick.card));
  return (
    <View style={{ marginHorizontal: sizes.side, height: Math.round(height * 0.56), borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface }}>
      <Artwork path={tile.wide ?? tile.poster} size="w1280" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <Shade side="left" />
      <Shade side="bottom" />
      <View style={{ position: 'absolute', left: 28, bottom: 24, right: '40%' }}>
        <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '700', marginBottom: 6 }}>{pick.kind === 'continue' ? t('home.continue') : t('home.recentlyAdded')}</Text>
        <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -0.5 }}>{tile.title}</Text>
        {tile.meta.length > 0 && <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 15, fontWeight: '600', marginTop: 8 }}>{tile.meta.join('  ·  ')}</Text>}
        {tile.progress > 0 && (
          <View style={{ height: 4, width: 220, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 10, overflow: 'hidden' }}>
            <View style={{ height: 4, width: `${Math.round(tile.progress * 100)}%`, backgroundColor: colors.accent }} />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <TvButton label={t('player.play')} icon="play" onPress={play} onFocus={onFocus} />
          <TvButton label={t('home.moreInfo')} icon="info" onPress={info} onFocus={onFocus} />
        </View>
      </View>
    </View>
  );
}

function openContinueDetails(item: ContinueItem) {
  if (item.type === 'movie') router.push(`/movie/${item.id}`);
  else if (item.showId) router.push(`/show/${item.showId}`);
}

/** Tiles with the genres of the library: OK opens the genre. */
function GenreRow({ sizes, onFocus }: { sizes: Sizes; onFocus: () => void }) {
  const { api, serverUrl } = useSession();
  const movies = useQuery({ queryKey: [serverUrl, 'genres', 'movies'], queryFn: () => api.get<Genre[]>('/api/genres?type=movies'), staleTime: 5 * 60_000 });
  const shows = useQuery({ queryKey: [serverUrl, 'genres', 'shows'], queryFn: () => api.get<Genre[]>('/api/genres?type=shows'), staleTime: 5 * 60_000 });
  const tiles = genreTiles(movies.data ?? [], shows.data ?? []);
  if (!tiles.length) return null;
  return (
    <FlatList
      horizontal
      data={tiles}
      keyExtractor={(g) => `${g.kind}-${g.id}`}
      style={{ marginTop: 18 }}
      contentContainerStyle={{ paddingHorizontal: sizes.side, gap: 12 }}
      showsHorizontalScrollIndicator={false}
      renderItem={({ item }) => (
        <Focusable accessibilityRole="button" accessibilityLabel={item.name} onFocus={onFocus} onPress={() => router.push({ pathname: '/genres', params: { scope: 'library', kind: item.kind, genre: String(item.id) } })}>
          {(focused) => (
            <View style={{ height: 64, minWidth: 150, paddingHorizontal: 22, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.accent : colors.raised, transform: [{ scale: focused ? 1.06 : 1 }] }}>
              <Text numberOfLines={1} style={{ color: focused ? colors.accentInk : colors.ink, fontSize: 19, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{item.name}</Text>
            </View>
          )}
        </Focusable>
      )}
    />
  );
}

function Tile({ tile, chosen, sizes, onFocus, onBlur, onPress }: { tile: TvTile; chosen: boolean; sizes: Sizes; onFocus: () => void; onBlur: () => void; onPress: () => void }) {
  const width = chosen ? sizes.wide : sizes.poster;
  return (
    <Focusable accessibilityRole="button" accessibilityLabel={tile.title} onFocus={onFocus} onBlur={onBlur} onPress={onPress}>
      {() => (
        <View style={{ width, height: sizes.tile, borderRadius: radius.md, overflow: 'hidden', borderWidth: 3, borderColor: chosen ? colors.ink : 'transparent', backgroundColor: colors.raised }}>
          <Artwork path={chosen ? (tile.wide ?? tile.poster) : tile.poster} size={chosen ? 'w780' : 'w342'} label={tile.title} style={{ width: '100%', height: '100%' }} />
          {chosen && (
            <>
              <Shade side="bottom" />
              <Text numberOfLines={2} style={{ position: 'absolute', left: 14, right: 14, bottom: tile.progress > 0 ? 16 : 10, color: colors.ink, fontSize: 22, fontWeight: '800' }}>{tile.title}</Text>
            </>
          )}
          {tile.badge && (
            <Text numberOfLines={1} style={{ position: 'absolute', top: 8, right: 8, maxWidth: width - 16, backgroundColor: 'rgba(20,18,28,0.85)', color: colors.accent, fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' }}>{tile.badge}</Text>
          )}
          {tile.progress > 0 && (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.25)' }}>
              <View style={{ height: 4, width: `${Math.round(tile.progress * 100)}%`, backgroundColor: colors.accent }} />
            </View>
          )}
        </View>
      )}
    </Focusable>
  );
}

/**
 * A row: posters, and the one with the focus wide at the left edge with its facts and
 * description under the row (only in the row that has the focus).
 */
function TvRow({ title, tiles, sizes, onPress, onFocusRow, onEndReached }: { title: string; tiles: TvTile[]; sizes: Sizes; onPress: (i: number) => void; onFocusRow: () => void; onEndReached?: () => void }) {
  const list = useRef<FlatList<TvTile>>(null);
  const focused = useRef<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  if (!tiles.length) return null;
  const pick = chosen !== null ? tiles[chosen] : undefined;
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '700', marginBottom: 10, paddingHorizontal: sizes.side }}>{title}</Text>
      <FlatList
        ref={list}
        horizontal
        data={tiles}
        keyExtractor={(x) => x.key}
        extraData={chosen}
        initialNumToRender={8}
        windowSize={5}
        onEndReached={onEndReached}
        onEndReachedThreshold={2}
        contentContainerStyle={{ paddingHorizontal: sizes.side, gap: sizes.gap, paddingRight: sizes.side + sizes.wide }}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <Tile
            tile={item}
            chosen={chosen === index}
            sizes={sizes}
            onPress={() => onPress(index)}
            onFocus={() => {
              focused.current = index;
              setChosen(index);
              onFocusRow();
              list.current?.scrollToOffset({ offset: rowOffset(index, sizes.poster, sizes.gap), animated: true });
            }}
            onBlur={() => {
              focused.current = null;
              // Moving within the row focuses the next tile right away; only leaving the row folds it up.
              setTimeout(() => focused.current === null && setChosen(null), 0);
            }}
          />
        )}
      />
      {pick && (
        <View style={{ height: INFO, paddingHorizontal: sizes.side, paddingTop: 12, maxWidth: '62%' }}>
          {pick.meta.length > 0 && <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{pick.meta.join('  ·  ')}</Text>}
          {pick.overview ? <Text numberOfLines={3} style={{ color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 6 }}>{pick.overview}</Text> : null}
        </View>
      )}
    </View>
  );
}

function CardRow({ title, cards, sizes, onFocusRow }: { title: string; cards: Card[]; sizes: Sizes; onFocusRow: () => void }) {
  const { t } = useSession();
  return <TvRow title={title} tiles={cards.map((c) => cardTile(c, t))} sizes={sizes} onFocusRow={onFocusRow} onPress={(i) => openCard(cards[i]!)} />;
}

function DiscoverTvRow({ spec, sizes, onFocusRow, onOpen }: { spec: DiscoverRow; sizes: Sizes; onFocusRow: () => void; onOpen: (item: SeerrResult) => void }) {
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
    <TvRow
      title={title}
      tiles={items.map((x) => discoverTile(x, t))}
      sizes={sizes}
      onFocusRow={onFocusRow}
      onPress={(i) => onOpen(items[i]!)}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
    />
  );
}

/**
 * The home screen on a TV: a big title at the top, the genres, and rows in which the title with
 * the focus grows wide with its description underneath. The row with the focus scrolls to the top.
 */
export function TvHome({ data }: { data: HomeData }) {
  const { api, t, serverUrl } = useSession();
  const { width, height } = useWindowDimensions();
  const sizes = tvSizes(width, height);
  const scroll = useRef<ScrollView>(null);
  const tops = useRef(new Map<string, number>());
  const active = useRef<string>('hero');
  const [rows, setRows] = useState(3);
  const seerr = useQuery({ queryKey: [serverUrl, 'seerr'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const { open } = useOpenDiscover();

  const toActive = () => {
    const y = active.current === 'hero' ? 0 : (tops.current.get(active.current) ?? 0) - 8;
    scroll.current?.scrollTo({ y: Math.max(0, y), animated: true });
  };
  const focusRow = (key: string, discoverIndex?: number) => () => {
    if (discoverIndex !== undefined && discoverIndex >= rows - 2) setRows((n) => Math.max(n, discoverIndex + 3));
    if (active.current === key) return;
    active.current = key;
    toActive();
  };
  // A row above folds up or opens: everything under it moves, so follow the row with the focus.
  const place = (key: string) => (y: number) => {
    tops.current.set(key, y);
    if (key === active.current) toActive();
  };
  const section = (key: string, node: ReactNode) => (
    <View key={key} onLayout={(e) => place(key)(e.nativeEvent.layout.y)}>
      {node}
    </View>
  );

  const d = data;
  return (
    <ScrollView ref={scroll} contentContainerStyle={{ paddingTop: 8, paddingBottom: height }}>
      {section('hero', <Hero data={d} sizes={sizes} onFocus={focusRow('hero')} />)}
      {section('genres', <GenreRow sizes={sizes} onFocus={focusRow('hero')} />)}
      {d.continueWatching.length > 0 &&
        section(
          'continue',
          <TvRow
            title={t('home.continue')}
            tiles={d.continueWatching.map((c) => continueTile(c, t))}
            sizes={sizes}
            onFocusRow={focusRow('continue')}
            onPress={(i) => {
              const item = d.continueWatching[i]!;
              router.push(`/play/${item.type}/${item.id}`);
            }}
          />,
        )}
      {section('watchlist', <CardRow title={t('home.watchlist')} cards={d.watchlist ?? []} sizes={sizes} onFocusRow={focusRow('watchlist')} />)}
      {section('recent', <CardRow title={t('home.recentlyAdded')} cards={d.recentlyAdded} sizes={sizes} onFocusRow={focusRow('recent')} />)}
      {section('movies', <CardRow title={t('home.movies')} cards={d.movies} sizes={sizes} onFocusRow={focusRow('movies')} />)}
      {section('shows', <CardRow title={t('home.shows')} cards={d.shows} sizes={sizes} onFocusRow={focusRow('shows')} />)}
      {section('favorites', <CardRow title={t('home.favorites')} cards={d.favorites ?? []} sizes={sizes} onFocusRow={focusRow('favorites')} />)}
      {seerr.data?.enabled &&
        DISCOVER_ROWS.slice(0, rows).map((spec, i) => {
          const key = `discover-${spec.row}-${spec.genre ?? ''}`;
          return section(key, <DiscoverTvRow spec={spec} sizes={sizes} onFocusRow={focusRow(key, i)} onOpen={(item) => void open(item)} />);
        })}
    </ScrollView>
  );
}
