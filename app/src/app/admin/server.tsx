import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AdminScreen, Card } from '../../components/Admin';
import { Hint, SwitchRow, useServerSettings } from '../../components/AdminSettings';
import { Button, ErrorState, Field, Loading, styles } from '../../components/ui';
import { changedFields, hasChanges } from '../../lib/adminSettings';
import { dialog } from '../../lib/dialog';
import { useSession } from '../../lib/session';

/** Admin → Server: the server's name, the update notice, its version and media folders. */
export default function ServerPage() {
  const { t } = useSession();
  const { query: q, save } = useServerSettings();
  const [form, setForm] = useState({ serverName: '', updateCheck: true });
  useEffect(() => {
    if (q.data) setForm({ serverName: q.data.serverName, updateCheck: q.data.updateCheck });
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const submit = () => {
    const name = form.serverName.trim();
    if (!name || name.length > 64) return dialog.alert(t('common.error'), t('settings2.server.nameInvalid'));
    const changes = changedFields({ serverName: s.serverName, updateCheck: s.updateCheck }, { serverName: name, updateCheck: form.updateCheck });
    if (!hasChanges(changes)) return dialog.alert('Vidalune', t('settings2.noChanges'));
    save.mutate(changes);
  };
  return (
    <AdminScreen title={t('admin.server')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Card title={t('settings2.server.title')}>
        <Field label={t('settings2.server.name')} value={form.serverName} maxLength={64} autoCorrect={false} onChangeText={(v) => setForm({ ...form, serverName: v })} />
        <SwitchRow label={t('settings2.server.updateCheck')} hint={t('settings2.server.updateCheckHint')} value={form.updateCheck} onChange={(v) => setForm({ ...form, updateCheck: v })} />
        <Button label={t('settings2.save')} busy={save.isPending} onPress={submit} />
      </Card>
      <Card>
        <View style={{ gap: 4 }}>
          <Hint>{t('settings2.server.version')}</Hint>
          <Text style={styles.body}>Vidalune {s.version}</Text>
        </View>
        <View style={{ gap: 4 }}>
          <Hint>{t('settings2.server.mediaRoots')}</Hint>
          {s.mediaRoots.map((root) => (
            <Text key={root} style={[styles.body, { fontFamily: 'monospace', fontSize: 13 }]}>{root}</Text>
          ))}
        </View>
      </Card>
    </AdminScreen>
  );
}
