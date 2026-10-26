import { Switch, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, confirmThen, Pill, SmallButton, useAdminAction } from '../../components/Admin';
import { ErrorState, Loading, styles } from '../../components/ui';
import { canBlock, type AdminUser } from '../../lib/admin';
import { ago } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

/** Admin → Users: block or allow someone again, and whether they may request movies and shows. */
export default function Users() {
  const { api, t, serverUrl, user: me } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'users'], queryFn: () => api.get<AdminUser[]>('/api/users') });
  const change = useAdminAction(({ user, patch }: { user: AdminUser; patch: Partial<Pick<AdminUser, 'disabled' | 'seerrAccess'>> }) => api.put(`/api/users/${user.id}`, patch), [[serverUrl, 'admin']]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const now = Date.now();
  return (
    <AdminScreen title={t('admin.users')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.data.map((u) => {
        const name = u.displayName || u.username;
        const busy = change.isPending && change.variables?.user.id === u.id;
        const seen = u.lastLoginAt ? ago(u.lastLoginAt, now) : null;
        return (
          <Card
            key={u.id}
            title={name}
            right={
              canBlock(u, me) ? (
                <SmallButton
                  label={u.disabled ? t('admin.unblock') : t('admin.block')}
                  danger={!u.disabled}
                  busy={busy && change.variables?.patch.disabled !== undefined}
                  onPress={() => (u.disabled ? change.mutate({ user: u, patch: { disabled: false } }) : confirmThen(t('admin.blockConfirm', { name }), t('admin.block'), t('common.cancel'), () => change.mutate({ user: u, patch: { disabled: true } })))}
                />
              ) : undefined
            }
          >
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {u.role === 'admin' && <Pill text={t('admin.user.admin')} tone="accent" />}
              {u.disabled && <Pill text={t('admin.user.blocked')} tone="danger" />}
              <Text style={styles.muted}>{seen ? t('admin.user.lastSeen', { when: t(seen.key, { n: seen.n }) }) : t('admin.user.never')}</Text>
            </View>
            {u.role !== 'admin' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={[styles.body, { flex: 1 }]}>{t('admin.seerrAccess')}</Text>
                <Switch
                  accessibilityLabel={`${t('admin.seerrAccess')}: ${name}`}
                  value={u.seerrAccess}
                  disabled={busy}
                  onValueChange={(on) => change.mutate({ user: u, patch: { seerrAccess: on } })}
                  trackColor={{ true: colors.button, false: colors.line }}
                  thumbColor={u.seerrAccess ? colors.accent : colors.muted}
                />
              </View>
            )}
          </Card>
        );
      })}
    </AdminScreen>
  );
}
