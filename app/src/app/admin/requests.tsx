import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, confirmThen, Pill, SmallButton, useAdminAction } from '../../components/Admin';
import { DownloadBar } from '../../components/DownloadBar';
import { Artwork } from '../../components/media';
import { ErrorState, Loading, styles } from '../../components/ui';
import { requestActions, type AdminRequest, type RequestAction } from '../../lib/admin';
import { DOWNLOAD_POLL_MS } from '../../lib/download';
import { useSession } from '../../lib/session';
import { radius } from '../../lib/theme';

/** Admin → Requests: everyone's requests; approve or decline one waiting for it, or cancel one. */
export default function Requests() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({
    queryKey: [serverUrl, 'admin', 'requests'],
    queryFn: () => api.get<AdminRequest[]>('/api/admin/seerr/requests'),
    refetchInterval: (query) => (query.state.data?.some((r) => r.download) ? DOWNLOAD_POLL_MS : false),
  });
  const act = useAdminAction(
    ({ r, action }: { r: AdminRequest; action: RequestAction }) =>
      action === 'cancel' ? api.del(`/api/admin/seerr/requests/${r.id}`) : api.post(`/api/admin/seerr/requests/${r.id}/${action}`),
    [[serverUrl, 'admin'], [serverUrl, 'seerr']],
  );
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const run = (r: AdminRequest, action: RequestAction) => {
    if (action === 'approve') return act.mutate({ r, action });
    const message = action === 'cancel' ? t('admin.cancelConfirm', { title: r.title }) : t('admin.declineConfirm', { title: r.title });
    confirmThen(message, action === 'cancel' ? t('admin.cancelRequest') : t('admin.decline'), t('common.cancel'), () => act.mutate({ r, action }));
  };
  const label = { approve: t('admin.approve'), decline: t('admin.decline'), cancel: t('admin.cancelRequest') };
  return (
    <AdminScreen title={t('admin.requests')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.data.length === 0 && <Text style={styles.muted}>{t('admin.noRequests')}</Text>}
      {q.data.map((r) => (
        <Card key={r.id}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Artwork path={r.posterPath} size="w185" label={r.title} style={{ width: 56, height: 84, borderRadius: radius.sm }} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={2}>{r.title}</Text>
              <Text style={styles.muted}>
                {r.mediaType === 'movie' ? t('admin.movie') : t('admin.show')} · {r.user ?? '—'} · {new Date(r.createdAt).toLocaleDateString()}
              </Text>
              <Pill text={t(`admin.state.${r.state}`)} tone={r.state === 'requested' ? 'warn' : r.state === 'declined' || r.state === 'failed' ? 'danger' : r.state === 'available' ? 'ok' : 'muted'} />
              {r.download ? <DownloadBar download={r.download} title={r.title} /> : null}
            </View>
          </View>
          {requestActions(r.state).length > 0 && (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {requestActions(r.state).map((a) => (
                <SmallButton key={a} label={label[a]} filled={a === 'approve'} danger={a !== 'approve'} busy={act.isPending && act.variables?.r.id === r.id && act.variables.action === a} disabled={act.isPending && act.variables?.r.id === r.id} onPress={() => run(r, a)} />
              ))}
            </View>
          )}
        </Card>
      ))}
    </AdminScreen>
  );
}
