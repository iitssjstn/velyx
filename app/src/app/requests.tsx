import { Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Pill } from '../components/Admin';
import { DownloadBar } from '../components/DownloadBar';
import { Artwork } from '../components/media';
import { ErrorState, FocusPressable, Loading, styles } from '../components/ui';
import type { AdminRequest } from '../lib/admin';
import { requestTone } from '../lib/discover';
import { DOWNLOAD_POLL_MS } from '../lib/download';
import { useSession } from '../lib/session';
import { radius } from '../lib/theme';

type MyRequest = Omit<AdminRequest, 'user'>;

/** Account → My requests: what you asked for, how far it is, and how far fetching it is (as on the website). */
export default function MyRequests() {
  const { api, t, serverUrl } = useSession();
  const status = useQuery({ queryKey: [serverUrl, 'seerr'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const q = useQuery({
    queryKey: [serverUrl, 'seerr', 'requests'],
    queryFn: () => api.get<MyRequest[]>('/api/seerr/requests'),
    enabled: !!status.data?.enabled,
    refetchInterval: (query) => (query.state.data?.some((r) => r.download) ? DOWNLOAD_POLL_MS : false),
  });
  if (status.isLoading || (status.data?.enabled && q.isLoading)) return <Loading />;
  if (!status.data) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  if (!status.data.enabled) return <ErrorState error={new Error(t('requests.off'))} />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <AdminScreen title={t('requests.title')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.data.length === 0 && <Text style={styles.muted}>{t('requests.none')}</Text>}
      {q.data.map((r) => (
        <FocusPressable
          key={r.id}
          accessibilityRole="link"
          onPress={() => router.push(`/request/${r.mediaType}/${r.tmdbId}`)}
          style={Platform.isTV ? { borderRadius: radius.lg } : undefined}
        >
          <Card>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Artwork path={r.posterPath} size="w185" label={r.title} style={{ width: 56, height: 84, borderRadius: radius.sm }} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={2}>{r.title}</Text>
                <Text style={styles.muted}>{r.mediaType === 'movie' ? t('request.movie') : t('request.show')} · {new Date(r.createdAt).toLocaleDateString()}</Text>
                <Pill text={t(`admin.state.${r.state}`)} tone={r.state === 'removed' ? 'muted' : requestTone(r.state)} />
                {r.download ? <DownloadBar download={r.download} title={r.title} /> : null}
              </View>
            </View>
          </Card>
        </FocusPressable>
      ))}
    </AdminScreen>
  );
}
