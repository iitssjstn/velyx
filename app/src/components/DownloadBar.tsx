import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { DOWNLOAD_POLL_MS, IDLE_POLL_MS, downloadLine, downloadPercent, type Download } from '../lib/download';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

/** How far fetching a request is: a bar and "Fetching 42% · ~25m left". */
export function DownloadBar({ download: d, title }: { download: Download; title: string }) {
  const { t } = useSession();
  const pct = downloadPercent(d);
  const line = downloadLine(d, Date.now(), t);
  const tone = d.status === 'warning' ? colors.danger : d.status === 'downloading' ? colors.accent : colors.muted;
  return (
    <View style={{ gap: 4, width: '100%', maxWidth: 360 }} accessible accessibilityRole="progressbar" accessibilityLabel={t('download.label', { title })} accessibilityValue={{ min: 0, max: 100, now: pct, text: line }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: tone }} />
      </View>
      <Text style={{ color: d.status === 'warning' ? colors.danger : colors.muted, fontSize: 13 }}>{line}</Text>
    </View>
  );
}

/**
 * How far fetching a title in the library is, for its screen: a new season of a show that is here,
 * or a movie fetched again. Null while nothing is fetched, without Seerr or without access to it.
 */
export function useTitleDownload(type: 'movie' | 'tv', tmdbId: number | null | undefined): Download | null {
  const { api, serverUrl } = useSession();
  const seerr = useQuery({ queryKey: [serverUrl, 'seerr'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000 });
  const q = useQuery({
    queryKey: [serverUrl, 'seerr', 'download', type, tmdbId],
    queryFn: () => api.get<{ download: Download | null }>(`/api/seerr/${type}/${tmdbId}/download`),
    enabled: !!seerr.data?.enabled && !!tmdbId,
    // Every few seconds while something is fetched; now and then otherwise, so a season that starts
    // while the screen is open shows up.
    refetchInterval: (query) => (query.state.data?.download ? DOWNLOAD_POLL_MS : IDLE_POLL_MS),
  });
  return q.data?.download ?? null;
}
