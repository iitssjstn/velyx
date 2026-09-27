import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useServerAction } from '../../components/actions';
import { Block } from '../../components/Skeleton';
import { Button, ErrorState, styles } from '../../components/ui';
import { ago } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';

interface SessionInfo {
  id: string;
  client: 'web' | 'app';
  device: string;
  lastSeenAt: number;
  current: boolean;
}

/** Everywhere this account is signed in, with a way to sign out other devices. */
export default function Sessions() {
  const { t, api, serverUrl } = useSession();
  const send = useServerAction();
  const q = useQuery({ queryKey: [serverUrl, 'account-sessions'], queryFn: () => api.get<SessionInfo[]>('/api/account/sessions') });
  const others = (q.data ?? []).filter((s) => !s.current).length;
  const now = Date.now();

  const signOutAll = () =>
    Alert.alert('Velyx', t('account.signOutOthersConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.ok'),
        style: 'destructive',
        onPress: async () => {
          try {
            const r = await api.post<{ revoked: number }>('/api/account/sessions/revoke-others');
            Alert.alert('Velyx', t('account.signOutOthersDone', { n: r.revoked }));
          } catch (err) {
            Alert.alert(t('common.error'), (err as Error).message);
          } finally {
            void q.refetch();
          }
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: t('account.sessions') }} />
      {q.isLoading ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <Block key={i} width="100%" height={64} />
          ))}
        </View>
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, gap: 10, width: '100%', maxWidth: 640, alignSelf: 'center' }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
          ListHeaderComponent={<Text style={[styles.muted, { marginBottom: 6 }]}>{t('account.sessionsHint')}</Text>}
          ListFooterComponent={others > 0 ? <View style={{ marginTop: 10 }}><Button label={t('account.signOutOthersButton')} variant="ghost" onPress={signOutAll} /></View> : null}
          renderItem={({ item: s }) => {
            const when = ago(s.lastSeenAt, now);
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14 }}>
                <Feather name={s.client === 'app' ? 'smartphone' : 'monitor'} size={20} color={colors.muted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.ink, fontWeight: '600' }} numberOfLines={1}>{s.device}</Text>
                  <Text style={styles.muted}>{s.current ? t('account.thisDevice') : t('account.lastSeen', { time: t(when.key, { n: when.n }) })}</Text>
                </View>
                {!s.current && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('account.signOutDevice', { device: s.device })}
                    hitSlop={10}
                    onPress={async () => {
                      await send({ method: 'DELETE', path: `/api/account/sessions/${encodeURIComponent(s.id)}` });
                    }}
                    style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Feather name="log-out" size={20} color={colors.danger} />
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}
    </>
  );
}
