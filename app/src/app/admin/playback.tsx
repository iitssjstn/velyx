import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminScreen, Card, SmallButton } from '../../components/Admin';
import { Hint, OptionList, StatusLine, SwitchRow, useFailed, useServerSettings } from '../../components/AdminSettings';
import { Button, ErrorState, Field, Loading, styles } from '../../components/ui';
import { changedFields, ENCODERS, encoderNote, hasChanges, streamLimit, transcodingStatus, wholeNumberIn, type Encoder, type TranscodingState } from '../../lib/adminSettings';
import { dialog } from '../../lib/dialog';
import { useSession } from '../../lib/session';

/** Admin → Playback: converting video a device cannot play, and how far ahead the server converts. */
export default function Playback() {
  const { api, t, serverUrl } = useSession();
  const key = [serverUrl, 'admin', 'transcoding'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<TranscodingState>('/api/admin/transcoding') });
  const settings = useServerSettings().query;
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <AdminScreen
      title={t('admin.playback')}
      refreshing={q.isRefetching || settings.isRefetching}
      onRefresh={() => {
        void q.refetch();
        void settings.refetch();
      }}
    >
      <TranscodingPanel d={q.data} queryKey={key} />
      <AheadPanel />
    </AdminScreen>
  );
}

function TranscodingPanel({ d, queryKey }: { d: TranscodingState; queryKey: unknown[] }) {
  const { api, t } = useSession();
  const qc = useQueryClient();
  const failed = useFailed();
  const initial = () => ({ enabled: d.settings.enabled, encoder: d.settings.encoder, limit: d.settings.maxStreams ? String(d.settings.maxStreams) : '' });
  const [form, setForm] = useState(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(initial()), [d]);
  const save = useMutation({
    mutationFn: (body: TranscodingState['settings']) => api.put<TranscodingState>('/api/admin/transcoding', body),
    onSuccess: (next) => {
      qc.setQueryData(queryKey, next);
      dialog.alert('Vidalune', t('settings2.transcoding.saved'));
    },
    onError: failed,
  });
  const detect = useMutation({ mutationFn: () => api.post<TranscodingState>('/api/admin/transcoding/detect'), onSuccess: (next) => qc.setQueryData(queryKey, next), onError: failed });
  const status = transcodingStatus(d);
  const statusText =
    status.key === 'onWith'
      ? t('settings2.transcoding.onWith', { encoder: t(`settings2.transcoding.encoders.${status.encoder!}`) }) + (status.active ? ` · ${t('settings2.transcoding.active', { n: status.active })}` : '')
      : t(`settings2.transcoding.${status.key}`);
  const submit = () => {
    const limit = streamLimit(form.limit);
    if (!limit.ok) return dialog.alert(t('common.error'), t('settings2.transcoding.limitInvalid'));
    // The server takes the three fields together (one setting).
    save.mutate({ enabled: form.enabled, encoder: form.encoder, maxStreams: limit.value });
  };
  const note = (e: Encoder) => {
    const n = encoderNote(d.support, e);
    return n ? t(`settings2.transcoding.${n}`) : null;
  };
  return (
    <Card title={t('settings2.transcoding.title')}>
      <Text style={styles.muted}>{t('settings2.transcoding.description')}</Text>
      <StatusLine text={statusText} tone={status.key === 'onWith' ? 'ok' : status.key === 'noEncoder' ? 'warn' : 'muted'} />
      <SwitchRow label={t('settings2.transcoding.enable')} hint={t('settings2.transcoding.enableHint')} value={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>{t('settings2.transcoding.encoder')}</Text>
        <OptionList
          value={form.encoder}
          onChange={(v) => setForm({ ...form, encoder: v })}
          options={[{ value: 'auto' as const, label: t('settings2.transcoding.auto') }, ...ENCODERS.map((e) => ({ value: e, label: t(`settings2.transcoding.encoders.${e}`), note: note(e) }))]}
        />
        <Hint>{t('settings2.transcoding.encoderHint')}</Hint>
      </View>
      <Field label={t('settings2.transcoding.limit')} value={form.limit} placeholder={t('settings2.transcoding.noLimit')} keyboardType="number-pad" maxLength={3} onChangeText={(v) => setForm({ ...form, limit: v })} />
      <Hint>{t('settings2.transcoding.limitHint')}</Hint>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button label={t('settings2.save')} busy={save.isPending} onPress={submit} />
        <SmallButton label={t('settings2.transcoding.detect')} busy={detect.isPending} onPress={() => detect.mutate()} />
      </View>
    </Card>
  );
}

function AheadPanel() {
  const { t } = useSession();
  const { query: q, save } = useServerSettings();
  const [ahead, setAhead] = useState('');
  useEffect(() => {
    if (q.data) setAhead(String(q.data.aheadSeconds));
  }, [q.data]);
  if (!q.data) return q.isLoading ? null : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const saved = q.data.aheadSeconds;
  const submit = () => {
    const n = wholeNumberIn(ahead, 30, 3600);
    if (n === null) return dialog.alert(t('common.error'), t('settings2.ahead.invalid'));
    const changes = changedFields({ aheadSeconds: saved }, { aheadSeconds: n });
    if (!hasChanges(changes)) return dialog.alert('Vidalune', t('settings2.noChanges'));
    save.mutate(changes);
  };
  return (
    <Card title={t('settings2.ahead.title')}>
      <Text style={styles.muted}>{t('settings2.ahead.text')}</Text>
      <Field label={t('settings2.ahead.seconds')} value={ahead} keyboardType="number-pad" maxLength={4} onChangeText={setAhead} />
      <Hint>{t('settings2.ahead.hint')}</Hint>
      <Button label={t('settings2.save')} busy={save.isPending} onPress={submit} />
    </Card>
  );
}
