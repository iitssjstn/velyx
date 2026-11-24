import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Pill, SmallButton, confirmThen, useAdminAction } from '../../../components/Admin';
import { ErrorState, Loading, styles } from '../../../components/ui';
import { dialog } from '../../../lib/dialog';
import { formatClock } from '../../../lib/format';
import { openReports, type AnalyzeScope, type Part, type SegmentEpisode, type ShowSegments } from '../../../lib/adminPages';
import type { Translate } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';

function partLine(label: string, p: Part | null | undefined, t: Translate): string {
  if (!p) return `${label}: ${t('segments.none')}`;
  const sure = p.confidence ? ` · ${t(`segments.confidence.${p.confidence}`)}` : '';
  const from = p.source ? ` · ${t(`segments.source.${p.source}`)}` : '';
  return `${label}: ${formatClock(p.start)}–${formatClock(p.end)}${sure}${from}`;
}

/** One show in Admin → Intros and credits: what viewers report, and per episode what was found. */
export default function SegmentShow() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, t, serverUrl } = useSession();
  const key = [serverUrl, 'admin', 'segments'];
  const q = useQuery({ queryKey: [...key, 'show', id], queryFn: () => api.get<ShowSegments>(`/api/admin/segments/shows/${id}`) });
  const analyze = useAdminAction(
    async (body: AnalyzeScope) => {
      const r = await api.post<{ queued: number }>('/api/admin/segments/analyze', body);
      dialog.alert('Vidalune', r.queued ? t('segments.queued', { n: r.queued }) : t('segments.nothingToDo'));
    },
    [key],
  );
  const resolve = useAdminAction((reportId: number) => api.post(`/api/admin/segments/reports/${reportId}/resolve`, {}), [key]);
  const reset = useAdminAction((episodeId: number) => api.del(`/api/admin/segments/episodes/${episodeId}`), [key]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const reports = openReports(s);
  const code = (season: number, e: SegmentEpisode) => `S${String(season).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}`;
  return (
    <AdminScreen title={s.show.title} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <View style={{ flexDirection: 'row' }}>
        <SmallButton label={t('segments.analyzeShow')} busy={analyze.isPending && analyze.variables?.scope === 'show'} onPress={() => analyze.mutate({ scope: 'show', showId: s.show.id })} />
      </View>

      {reports.length > 0 && (
        <Card title={t('segments.reports')}>
          {reports.map(({ report: r, seasonNumber, episode }) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.body}>
                  {code(seasonNumber, episode)} · {t(`report.kind.${r.kind}`)}: {t(`report.problem.${r.problem}`).toLowerCase()}
                </Text>
                <Text style={styles.muted}>
                  {r.user}
                  {r.position !== null ? ` · ${t('segments.around', { time: formatClock(r.position) })}` : ''}
                </Text>
              </View>
              <SmallButton label={t('segments.resolve')} busy={resolve.isPending && resolve.variables === r.id} onPress={() => resolve.mutate(r.id)} />
            </View>
          ))}
        </Card>
      )}

      {s.seasons.map((season) => (
        <Card
          key={season.seasonNumber}
          title={season.seasonNumber === 0 ? t('segments.specials') : t('segments.season', { n: season.seasonNumber })}
          right={
            <SmallButton
              label={t('segments.analyzeAgain')}
              busy={analyze.isPending && analyze.variables?.scope === 'season' && analyze.variables.seasonNumber === season.seasonNumber}
              onPress={() => analyze.mutate({ scope: 'season', showId: s.show.id, seasonNumber: season.seasonNumber })}
            />
          }
        >
          {season.episodes.map((e) => {
            const seg = e.segments;
            return (
              <View key={e.id} style={{ gap: 3, paddingVertical: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={[styles.body, { fontWeight: '600' }]}>
                    {code(season.seasonNumber, e)}
                    {e.title ? ` · ${e.title}` : ''}
                  </Text>
                  {seg?.manual ? <Pill text={t('segments.manualOne')} /> : null}
                  {e.reports?.length ? <Pill text={t('segments.reportsCount', { n: e.reports.length })} tone="accent" /> : null}
                </View>
                {!e.eligible ? (
                  <Text style={styles.muted}>{t('segments.noFile')}</Text>
                ) : !seg ? (
                  <Text style={styles.muted}>{t('segments.notYet')}</Text>
                ) : seg.status === 'error' ? (
                  <Text style={styles.error}>{seg.error ?? t('segments.failed')}</Text>
                ) : (
                  <>
                    {seg.recap ? <Text style={styles.muted}>{partLine(t('report.kind.recap'), seg.recap, t)}</Text> : null}
                    <Text style={styles.muted}>{partLine(t('report.kind.intro'), seg.intro, t)}</Text>
                    <Text style={styles.muted}>{partLine(t('report.kind.credits'), seg.credits, t)}</Text>
                  </>
                )}
                {e.eligible && (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <SmallButton
                      label={t('segments.analyzeAgain')}
                      busy={analyze.isPending && analyze.variables?.scope === 'episode' && analyze.variables.episodeId === e.id}
                      onPress={() => analyze.mutate({ scope: 'episode', episodeId: e.id })}
                    />
                    {seg?.manual && (
                      <SmallButton
                        label={t('segments.removeCorrection')}
                        danger
                        busy={reset.isPending && reset.variables === e.id}
                        onPress={() => confirmThen(t('segments.removeCorrectionText'), t('segments.removeCorrection'), t('common.cancel'), () => reset.mutate(e.id))}
                      />
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </Card>
      ))}
    </AdminScreen>
  );
}
