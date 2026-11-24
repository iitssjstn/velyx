import { useState } from 'react';
import { Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Chips } from '../../components/Admin';
import { ErrorState, Field, FocusPressable, Loading, styles } from '../../components/ui';
import { filterLogs, type LogEntry, type LogLevel } from '../../lib/adminPages';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

const LEVEL_COLOR: Record<LogEntry['level'], string> = { debug: colors.faint, info: colors.muted, warn: '#f0b860', error: colors.danger };

/** Admin → Log: the server's recent lines, newest first; loads again every 5 seconds. */
export default function Logs() {
  const { api, t, serverUrl, user } = useSession();
  const [level, setLevel] = useState<LogLevel>('all');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'logs'], queryFn: () => api.get<LogEntry[]>('/api/admin/logs'), refetchInterval: 5000 });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const rows = filterLogs(q.data, level, text);
  const locale = user?.language === 'nl' ? 'nl-NL' : 'en-GB';
  return (
    <AdminScreen title={t('admin.logs')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Chips value={level} onChange={setLevel} choices={[{ value: 'all', label: t('logs.all') }, { value: 'warn', label: t('logs.warnings') }, { value: 'error', label: t('logs.errors') }]} />
      <Field label={t('logs.filter')} value={text} onChangeText={setText} autoCorrect={false} autoCapitalize="none" />
      <Text style={styles.muted}>{t('logs.hint')}</Text>
      <Card>
        {rows.length === 0 && <Text style={styles.muted}>{t('logs.none')}</Text>}
        {rows.map((l, i) => (
          <FocusPressable key={`${l.time}-${i}`} disabled={!l.stack} onPress={() => setOpen(open === i ? null : i)} style={{ gap: 2, paddingVertical: 4 }}>
            <Text style={{ color: colors.faint, fontSize: 12 }}>
              {new Date(l.time).toLocaleTimeString(locale)} · <Text style={{ color: LEVEL_COLOR[l.level], fontWeight: '700' }}>{l.level.toUpperCase()}</Text> · <Text style={{ color: colors.accent }}>{l.module}</Text>
            </Text>
            <Text style={[styles.body, { fontSize: 14 }]} selectable>{l.message}</Text>
            {l.stack && open === i ? <Text style={{ color: colors.faint, fontSize: 11, fontFamily: 'monospace' }} selectable>{l.stack}</Text> : null}
          </FocusPressable>
        ))}
      </Card>
    </AdminScreen>
  );
}

