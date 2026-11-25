import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Pill, SmallButton } from '../../components/Admin';
import { Artwork } from '../../components/media';
import { ErrorState, Loading, styles } from '../../components/ui';
import { adminLists, editHref, filterLines } from '../../lib/adminCollections';
import type { CollectionSummary, SmartCollection } from '../../lib/collections';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';

/** Admin → Collections: the collections an administrator made (by hand and smart), and the movie series. */
export default function AdminCollections() {
  const { api, t, serverUrl } = useSession();
  const list = useQuery({ queryKey: [serverUrl, 'collections'], queryFn: () => api.get<CollectionSummary[]>('/api/collections') });
  const smart = useQuery({ queryKey: [serverUrl, 'collections', 'smart'], queryFn: () => api.get<SmartCollection[]>('/api/collections/smart') });
  const refresh = () => {
    void list.refetch();
    void smart.refetch();
  };
  if (list.isLoading || smart.isLoading) return <Loading />;
  if (!list.data || !smart.data) return <ErrorState error={list.error ?? smart.error} onRetry={refresh} />;
  const lists = adminLists(list.data, smart.data);
  return (
    <AdminScreen title={t('adminCollections.title')} refreshing={list.isRefetching || smart.isRefetching} onRefresh={refresh}>
      <Text style={styles.muted}>{t('adminCollections.hint')}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <SmallButton label={t('adminCollections.new')} filled onPress={() => router.push(editHref(null) as never)} />
        <SmallButton label={t('adminCollections.newSmart')} onPress={() => router.push(editHref(null, true) as never)} />
      </View>

      <Card title={t('adminCollections.manual')}>
        {lists.manual.length === 0 ? (
          <Text style={styles.muted}>{t('adminCollections.none')}</Text>
        ) : (
          lists.manual.map((c) => (
            <Row key={c.id} poster={c.posterPath} name={c.name} line={t('collections.itemCount', { n: c.itemCount })} onPress={() => router.push(editHref({ id: c.id }) as never)} />
          ))
        )}
      </Card>

      <Card title={t('adminCollections.smart')}>
        {lists.smart.length === 0 ? (
          <Text style={styles.muted}>{t('adminCollections.none')}</Text>
        ) : (
          lists.smart.map((c) => {
            const rules = filterLines(c).map((l) => t(l.key, l.params));
            const kind = t(c.kind === 'movies' ? 'adminCollections.kindMovies' : 'adminCollections.kindShows');
            return (
              <Row
                key={c.key}
                poster={c.posterPath}
                name={c.name}
                line={[kind, ...rules].join(' · ')}
                pill={t('adminCollections.count', { n: c.count })}
                onPress={() => router.push(editHref({ id: c.id!, smart: true }) as never)}
              />
            );
          })
        )}
      </Card>

      {lists.auto.length > 0 && (
        <Card title={t('adminCollections.auto')}>
          <Text style={styles.muted}>{t('adminCollections.autoHint')}</Text>
          {lists.auto.map((c) => (
            <Row key={c.id} poster={c.posterPath} name={c.name} line={t('collections.itemCount', { n: c.itemCount })} onPress={() => router.push(`/collections/${c.id}`)} />
          ))}
        </Card>
      )}
    </AdminScreen>
  );
}

function Row({ poster, name, line, pill, onPress }: { poster: string | null; name: string; line: string; pill?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Artwork path={poster} size="w185" label={name} style={{ width: 44, height: 66, borderRadius: radius.sm, backgroundColor: colors.bg }} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={1}>{name}</Text>
        <Text style={styles.muted} numberOfLines={2}>{line}</Text>
        {pill ? <Pill text={pill} /> : null}
      </View>
    </Pressable>
  );
}
