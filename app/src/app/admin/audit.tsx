import { useState } from 'react';
import { Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Chips, SmallButton } from '../../components/Admin';
import { ErrorState, Loading, styles } from '../../components/ui';
import { AUDIT_GROUPS, AUDIT_PAGE, auditLabel, auditPath, type AuditEntry, type AuditGroup, type Paged } from '../../lib/adminPages';
import { ago } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import { useSession } from '../../lib/session';

const GROUP_LABEL: Record<AuditGroup, MessageKey> = {
  '': 'audit.group.all',
  'login.': 'audit.group.signIns',
  'user.': 'audit.group.users',
  'session.': 'audit.group.sessions',
  'library.': 'audit.group.libraries',
  'cleanup.': 'audit.group.cleanup',
  'settings.updated': 'audit.group.settings',
  'tmdb.updated': 'audit.group.tmdb',
  'backup.': 'audit.group.backups',
  'subtitles.': 'audit.group.subtitles',
};

/** Admin → Audit log: sign-ins and what administrators changed, newest first, 50 at a time. */
export default function Audit() {
  const { api, t, serverUrl, user } = useSession();
  const [group, setGroup] = useState<AuditGroup>('');
  const q = useInfiniteQuery({
    queryKey: [serverUrl, 'admin', 'audit', group],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<Paged<AuditEntry>>(auditPath(pageParam, group)),
    getNextPageParam: (last) => (last.page * AUDIT_PAGE < last.total ? last.page + 1 : undefined),
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.pages.flatMap((p) => p.items);
  const lang = user?.language ?? 'en';
  const now = Date.now();
  return (
    <AdminScreen title={t('admin.audit')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Chips value={group} onChange={setGroup} choices={AUDIT_GROUPS.map((g) => ({ value: g, label: t(GROUP_LABEL[g]) }))} />
      <Text style={styles.muted}>{t('audit.hint')}</Text>
      <Card>
        {items.length === 0 && <Text style={styles.muted}>{t('audit.none')}</Text>}
        {items.map((e) => {
          const when = ago(e.at, now);
          return (
            <View key={e.id} style={{ gap: 2, paddingVertical: 4 }}>
              <Text style={[styles.body, { fontWeight: '600' }]}>
                {auditLabel(e.action, lang)}
                {e.target ? ` ${e.target}` : ''}
              </Text>
              <Text style={styles.muted}>
                {e.actorName ?? t('audit.unknown')} · {t(when.key, { n: when.n })}
                {e.ip ? ` · ${e.ip}` : ''}
              </Text>
              {e.detail ? <Text style={styles.muted}>{e.detail}</Text> : null}
            </View>
          );
        })}
      </Card>
      {q.hasNextPage && <SmallButton label={t('audit.more')} busy={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} />}
    </AdminScreen>
  );
}
