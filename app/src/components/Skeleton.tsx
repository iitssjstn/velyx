import { useEffect, useRef } from 'react';
import { Animated, View, type DimensionValue } from 'react-native';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { useGrid } from './media';

/** One pulsing placeholder block (shown where content is loading). */
export function Block({ width, height, round = radius.md }: { width: DimensionValue; height: DimensionValue; round?: number }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={{ width, height, borderRadius: round, backgroundColor: colors.raised, opacity }} />;
}

/** Placeholder for a poster grid (Movies, TV Shows, a list). */
export function GridSkeleton() {
  const { t } = useSession();
  const { columns, itemWidth } = useGrid();
  return (
    <View accessibilityLabel={t('common.loading')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16, rowGap: 16 }}>
      {Array.from({ length: columns * 3 }, (_, i) => (
        <View key={i} style={{ gap: 6 }}>
          <Block width={itemWidth} height={itemWidth * 1.5} />
          <Block width={itemWidth * 0.7} height={12} round={4} />
        </View>
      ))}
    </View>
  );
}

/** Placeholder for Home: a few shelves. */
export function ShelvesSkeleton({ poster }: { poster: number }) {
  const { t } = useSession();
  return (
    <View accessibilityLabel={t('common.loading')} style={{ gap: 28, paddingTop: 8 }}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={{ gap: 12, paddingHorizontal: 16 }}>
          <Block width={160} height={18} round={4} />
          <View style={{ flexDirection: 'row', gap: 12, overflow: 'hidden' }}>
            {Array.from({ length: 6 }, (_, i) => (row === 0 ? <Block key={i} width={poster * 2} height={poster * 1.125} /> : <Block key={i} width={poster} height={poster * 1.5} />))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Placeholder for a movie or show page. */
export function DetailSkeleton({ wide }: { wide: boolean }) {
  const { t } = useSession();
  return (
    <View accessibilityLabel={t('common.loading')} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Block width="100%" height={wide ? 320 : 210} round={0} />
      <View style={{ padding: 16, gap: 12, flexDirection: 'row' }}>
        <Block width={wide ? 180 : 96} height={wide ? 270 : 144} />
        <View style={{ flex: 1, gap: 10 }}>
          <Block width="70%" height={26} round={6} />
          <Block width="40%" height={14} round={4} />
          <Block width="55%" height={14} round={4} />
          <Block width={160} height={44} round={radius.pill} />
        </View>
      </View>
    </View>
  );
}
