import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Pill, SmallButton, confirmThen, useAdminAction } from '../../../components/Admin';
import { ErrorState, FocusPressable, Loading, ProgressLine, styles } from '../../../components/ui';
import { dialog } from '../../../lib/dialog';
import { analyzedFraction, segmentShowsByNeed, statusLine, type AnalyzeScope, type SegmentOverview } from '../../../lib/adminPages';
import { useSession } from '../../../lib/session';

/** Admin → Intros and credits: how far the detection is, and per show what it found and what viewers report. */
export default function Segments() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'segments'], queryFn: () => api.get<SegmentOverview>('/api/admin/segments'), refetchInterval: 15_000 });
  const analyze = useAdminAction(
    async (body: AnalyzeScope) => {
      const r = await api.post<{ queued: number }>('/api/admin/segments/analyze', body);
      dialog.alert('Vidalune', r.queued ? t('segments.queued', { n: r.queued }) : t('segments.nothingToDo'));
    },
    [[serverUrl, 'admin', 'segments']],
  );
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { status, shows, errors } = q.data;
  const c = status.counts;
  return (
    <AdminScreen title={t('admin.segments')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Card
        right={
          <SmallButton
            label={t('segments.analyzeAll')}
            busy={analyze.isPending}
            disabled={!status.enabled}
            onPress={() => confirmThen(t('segments.analyzeAllText'), t('segments.analyzeAll'), t('common.cancel'), () => analyze.mutate({ scope: 'all' }))}
          />
        }
        title={t('segments.status')}
      >
        <Text style={styles.body}>{statusLine(status, t)}</Text>
        <Text style={styles.muted}>
          {t('segments.counts', { analyzed: c.analyzed, episodes: c.episodes, intros: c.intros, credits: c.credits })}
          {c.recaps ? ` · ${t('segments.recaps', { n: c.recaps })}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {c.errors > 0 && <Pill text={t('segments.errors', { n: c.errors })} tone="danger" />}
          {c.lowConfidence > 0 && <Pill text={t('segments.low', { n: c.lowConfidence })} tone="warn" />}
          {c.manual > 0 && <Pill text={t('segments.manual', { n: c.manual })} />}
          {c.reports ? <Pill text={t('segments.reportsCount', { n: c.reports })} tone="accent" /> : null}
        </View>
      </Card>

      {errors.length > 0 && (
        <Card title={t('segments.problems')}>
          {errors.slice(0, 20).map((e) => (
            <FocusPressable key={e.episodeId} onPress={() => router.push(`/admin/segments/${e.showId}`)} style={{ gap: 2, paddingVertical: 4 }}>
              <Text style={[styles.body, { fontWeight: '600' }]}>{e.showTitle} · S{String(e.seasonNumber).padStart(2, '0')}E{String(e.episodeNumber).padStart(2, '0')}</Text>
              {e.error ? <Text style={styles.muted} numberOfLines={2}>{e.error}</Text> : null}
            </FocusPressable>
          ))}
        </Card>
      )}

      <Card title={t('segments.shows')}>
        {shows.length === 0 && <Text style={styles.muted}>{t('segments.noShows')}</Text>}
        {segmentShowsByNeed(shows).map((s) => (
          <FocusPressable key={s.id} accessibilityRole="button" onPress={() => router.push(`/admin/segments/${s.id}`)} style={({ pressed }) => ({ gap: 4, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}>
            <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={1}>{s.title}</Text>
            <Text style={styles.muted}>
              {t('segments.showLine', { analyzed: s.analyzed, episodes: s.episodes, intros: s.intros, credits: s.credits })}
              {s.errors ? ` · ${t('segments.errors', { n: s.errors })}` : ''}
              {s.low ? ` · ${t('segments.low', { n: s.low })}` : ''}
            </Text>
            <ProgressLine fraction={analyzedFraction(s)} />
          </FocusPressable>
        ))}
      </Card>
    </AdminScreen>
  );
}
