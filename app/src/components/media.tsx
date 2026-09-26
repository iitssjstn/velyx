import { FlatList, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { imagePath, progressFraction, type ImageSize } from '../lib/format';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import type { Card, ContinueItem } from '../lib/types';
import { Heading, ProgressLine, styles } from './ui';

/** Artwork from the server's image cache (the request carries the app's token). */
export function Artwork({ path, size, style, label }: { path: string | null | undefined; size: ImageSize; style: object; label?: string }) {
  const { api } = useSession();
  const p = imagePath(path, size);
  return (
    <View style={[{ backgroundColor: colors.raised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      {p ? (
        <Image source={{ uri: api.url(p), headers: api.headers() }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      ) : (
        label && <Text style={{ color: colors.muted, padding: 8, textAlign: 'center' }} numberOfLines={3}>{label}</Text>
      )}
    </View>
  );
}

export function openCard(card: Pick<Card, 'type' | 'id'>) {
  router.push(card.type === 'movie' ? `/movie/${card.id}` : `/show/${card.id}`);
}

export function PosterCard({ card, width = 120 }: { card: Card; width?: number }) {
  const progress = card.type === 'movie' ? progressFraction(card.progress) : 0;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={card.title} onPress={() => openCard(card)} style={{ width }}>
      <Artwork path={card.posterPath} size="w342" label={card.title} style={{ width, height: width * 1.5, borderRadius: radius.md }} />
      {progress > 0 && (
        <View style={{ marginTop: 4 }}>
          <ProgressLine fraction={progress} />
        </View>
      )}
      <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13, marginTop: 6 }}>{card.title}</Text>
      {card.year ? <Text style={{ color: colors.faint, fontSize: 12 }}>{card.year}</Text> : null}
    </Pressable>
  );
}

export function Shelf({ title, cards }: { title: string; cards: Card[] }) {
  if (!cards.length) return null;
  return (
    <View style={{ marginBottom: 24 }}>
      <Heading>{title}</Heading>
      <FlatList
        horizontal
        data={cards}
        keyExtractor={(c) => `${c.type}-${c.id}`}
        renderItem={({ item }) => <PosterCard card={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

/** Continue Watching plays straight away, from where the viewer stopped. */
function openContinue(item: ContinueItem) {
  router.push(`/play/${item.type}/${item.id}`);
}

export function ContinueShelf({ title, items }: { title: string; items: ContinueItem[] }) {
  const { t } = useSession();
  if (!items.length) return null;
  return (
    <View style={{ marginBottom: 24 }}>
      <Heading>{title}</Heading>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(c) => `${c.type}-${c.id}`}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => openContinue(item)} style={{ width: 240 }}>
            <Artwork path={item.imagePath ?? item.posterPath} size="w780" label={item.title} style={{ width: 240, height: 135, borderRadius: radius.md }} />
            <View style={{ marginTop: 4 }}>
              <ProgressLine fraction={item.percent / 100} />
            </View>
            <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 14, marginTop: 6, fontWeight: '600' }}>{item.title}</Text>
            {item.subtitle ? (
              <Text numberOfLines={1} style={styles.muted}>
                {item.upNext ? `${t('home.upNext')} · ` : ''}
                {item.subtitle}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
