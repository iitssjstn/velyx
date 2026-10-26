import { Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { AdminScreen, Card, Pill, SmallButton, useAdminAction } from '../../components/Admin';
import { ErrorState, FocusPressable, Loading, ProgressLine, styles } from '../../components/ui';
import { diskUsed, formatBytes, uptime, type AdminDashboard } from '../../lib/admin';
import { formatClock } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

/**
 * Admin, for administrators on a phone or tablet: how the server is doing and who is watching, the
 * scanner, and the screens for what is often needed away from home. The rest is on the website.
 */
export default function Admin() {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({
    queryKey: [serverUrl, 'admin', 'dashboard'],
    queryFn: () => api.get<AdminDashboard>('/api/admin/dashboard'),
    refetchInterval: 15_000,
  });
  const unread = useQuery({
    queryKey: [serverUrl, 'admin', 'notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/api/admin/notifications/unread'),
    refetchInterval: 60_000,
  });
  const scans = useAdminAction((path: string) => api.post(path), [[serverUrl, 'admin']]);

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const used = diskUsed(d.disk);
  const paused = d.scan.status === 'paused';
  const refresh = () => {
    void q.refetch();
    void unread.refetch();
  };

  return (
    <AdminScreen refreshing={q.isRefetching} onRefresh={refresh}>
      <Card title={d.serverName}>
        <Text style={styles.body}>{t('admin.version', { v: d.version })} · {t('admin.uptime', { t: uptime(d.uptimeSec) })}</Text>
        {d.update.available && d.update.latest ? <Pill text={t('admin.update', { v: d.update.latest })} tone="accent" /> : null}
        <Text style={styles.muted}>{t('admin.counts', { movies: d.counts.movies, shows: d.counts.shows, users: d.counts.users })}</Text>
        {d.cpu.system !== null && <Meter label={t('admin.cpu')} fraction={d.cpu.system / 100} detail={`${Math.round(d.cpu.system)}%`} />}
        {d.disk && used !== null && <Meter label={t('admin.disk')} fraction={used} detail={t('admin.diskFree', { free: formatBytes(d.disk.free) })} warn={d.disk.level !== 'ok'} />}
      </Card>

      <Card title={t('admin.watching')}>
        {d.streams.length === 0 ? (
          <Text style={styles.muted}>{t('admin.nobodyWatching')}</Text>
        ) : (
          d.streams.map((s) => (
            <View key={s.id} style={{ gap: 4 }}>
              <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={1}>{s.title}{s.subtitle ? ` · ${s.subtitle}` : ''}</Text>
              <Text style={styles.muted} numberOfLines={1}>
                {s.username}{s.device ? ` · ${s.device}` : ''} · {t(`admin.mode.${s.mode}`)}
                {s.positionSec !== null && s.durationSec ? ` · ${formatClock(s.positionSec)} / ${formatClock(s.durationSec)}` : ''}
              </Text>
              {s.positionSec !== null && s.durationSec ? <ProgressLine fraction={s.positionSec / s.durationSec} /> : null}
            </View>
          ))
        )}
      </Card>

      <Card
        title={t('admin.scanner')}
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SmallButton label={paused ? t('admin.resumeScans') : t('admin.pauseScans')} busy={scans.isPending && scans.variables?.includes('scans/')} onPress={() => scans.mutate(paused ? '/api/libraries/scans/resume' : '/api/libraries/scans/pause')} />
            <SmallButton label={t('admin.scanAll')} filled busy={scans.isPending && scans.variables?.endsWith('scan-all')} disabled={paused} onPress={() => scans.mutate('/api/libraries/scan-all')} />
          </View>
        }
      >
        <Text style={styles.body}>{t(`admin.scan.${d.scan.status}`)}</Text>
      </Card>

      <Card title={t('admin.manage')}>
        <Row icon="inbox" label={t('admin.requests')} href="/admin/requests" />
        <Row icon="folder" label={t('admin.libraries')} href="/admin/libraries" />
        <Row icon="cpu" label={t('admin.optimizations')} href="/admin/optimizations" />
        <Row icon="users" label={t('admin.users')} href="/admin/users" />
        <Row icon="bell" label={t('admin.notifications')} href="/admin/notifications" badge={unread.data?.unread ? t('admin.unread', { n: unread.data.unread }) : undefined} />
        <Row icon="activity" label={t('admin.activity')} href="/admin/activity" />
      </Card>
      <Text style={[styles.muted, { textAlign: 'center' }]}>{t('admin.website')}</Text>
    </AdminScreen>
  );
}

function Meter({ label, fraction, detail, warn }: { label: string; fraction: number; detail: string; warn?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`${label}: ${detail}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.muted}>{label}</Text>
        <Text style={styles.muted}>{detail}</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 6, backgroundColor: warn || pct >= 90 ? colors.danger : colors.accent }} />
      </View>
    </View>
  );
}

function Row({ icon, label, href, badge }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; href: Href; badge?: string }) {
  return (
    <FocusPressable accessibilityRole="button" onPress={() => router.push(href)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
      <Feather name={icon} size={18} color={colors.muted} />
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
      {badge ? <Pill text={badge} tone="accent" /> : null}
      <Feather name="chevron-right" size={18} color={colors.faint} />
    </FocusPressable>
  );
}
