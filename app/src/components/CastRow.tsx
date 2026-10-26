import { FlatList, Text, View } from 'react-native';
import { Artwork } from './media';
import { initials } from '../lib/tvDetail';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import type { Person } from '../lib/types';

/**
 * The cast of a movie or show on a phone or tablet, as on the TV: standing cards with photo, name and
 * role, in a row that scrolls to the right. Initials when there is no photo.
 */
export function CastRow({ cast, wide }: { cast: Person[]; wide: boolean }) {
  const { t } = useSession();
  if (!cast.length) return null;
  const card = wide ? 128 : 104;
  const side = wide ? 24 : 16;
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700', paddingHorizontal: side }} accessibilityRole="header">
        {t('detail.cast')}
      </Text>
      <FlatList
        horizontal
        data={cast.slice(0, 30)}
        keyExtractor={(p, i) => `${p.id ?? p.name}-${i}`}
        contentContainerStyle={{ paddingHorizontal: side, gap: 12 }}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item: p }) => (
          <View accessible accessibilityLabel={p.role ? `${p.name}, ${p.role}` : p.name} style={{ width: card, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
            <View style={{ width: '100%', height: Math.round(card * 1.3), backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
              {p.profilePath ? <Artwork path={p.profilePath} size="w185" style={{ width: '100%', height: '100%' }} /> : <Text style={{ color: colors.muted, fontSize: 26, fontWeight: '700' }}>{initials(p.name)}</Text>}
            </View>
            <View style={{ paddingHorizontal: 8, paddingVertical: 7 }}>
              <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13, fontWeight: '600' }}>{p.name}</Text>
              <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 12 }}>{p.role || ' '}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
