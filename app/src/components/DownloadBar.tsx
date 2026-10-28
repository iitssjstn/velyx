import { Text, View } from 'react-native';
import { downloadLine, downloadPercent, type Download } from '../lib/download';
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
