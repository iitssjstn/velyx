import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminScreen, Card, confirmThen, SmallButton } from '../../components/Admin';
import { Hint, StatusLine, useFailed } from '../../components/AdminSettings';
import { Button, ErrorState, Field, Loading, styles } from '../../components/ui';
import { canSaveService, filterItems, serviceBody, type ArrItem, type ServiceConfig } from '../../lib/adminSettings';
import { dialog } from '../../lib/dialog';
import { useSession } from '../../lib/session';

type ArrService = 'sonarr' | 'radarr';
interface ArrSettings {
  sonarr: ServiceConfig;
  radarr: ServiceConfig;
}

/** Admin → Integrations: Seerr for requests, and Sonarr and Radarr. Keys are write-only, as on the website. */
export default function Integrations() {
  const { api, t, serverUrl } = useSession();
  const seerr = useQuery({ queryKey: [serverUrl, 'admin', 'seerr'], queryFn: () => api.get<ServiceConfig>('/api/admin/seerr') });
  const arr = useQuery({ queryKey: [serverUrl, 'admin', 'arr'], queryFn: () => api.get<ArrSettings>('/api/admin/arr') });
  if (seerr.isLoading || arr.isLoading) return <Loading />;
  if (!seerr.data || !arr.data) return <ErrorState error={seerr.error ?? arr.error} onRetry={() => void Promise.all([seerr.refetch(), arr.refetch()])} />;
  return (
    <AdminScreen
      title={t('admin.integrations')}
      refreshing={seerr.isRefetching || arr.isRefetching}
      onRefresh={() => {
        void seerr.refetch();
        void arr.refetch();
      }}
    >
      <Text style={styles.muted}>{t('settings2.integrations.intro')}</Text>
      <SeerrPanel config={seerr.data} />
      <Text style={styles.muted}>{t('settings2.arr.intro')}</Text>
      <ArrPanel service="sonarr" config={arr.data.sonarr} />
      <ArrPanel service="radarr" config={arr.data.radarr} />
    </AdminScreen>
  );
}

function SeerrPanel({ config }: { config: ServiceConfig }) {
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const failed = useFailed();
  const [url, setUrl] = useState(config.url);
  const [apiKey, setApiKey] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => setUrl(config.url), [config.url]);
  const save = useMutation({
    mutationFn: (body: { url: string; apiKey?: string }) => api.put<ServiceConfig>('/api/admin/seerr', body),
    onSuccess: (d) => {
      qc.setQueryData([serverUrl, 'admin', 'seerr'], d);
      // Rows, search and Requests depend on whether Seerr is there.
      void qc.invalidateQueries({ queryKey: [serverUrl, 'seerr'] });
      setApiKey('');
      setVersion(d.version ?? null);
      dialog.alert('Vidalune', t(d.hasKey ? 'settings2.seerr.saved' : 'settings2.seerr.removed'));
    },
    onError: failed,
  });
  const on = !!config.url && config.hasKey;
  return (
    <Card title={t('settings2.seerr.title')}>
      <Text style={styles.muted}>{t('settings2.seerr.description')}</Text>
      <StatusLine
        text={on ? (version ? t('settings2.seerr.onVersion', { version, url: config.url }) : t('settings2.seerr.on', { url: config.url })) : t('settings2.service.notConnected')}
        tone={on ? 'ok' : 'muted'}
      />
      <Field label={t('settings2.seerr.url')} value={url} onChangeText={setUrl} placeholder="http://192.168.1.10:5055" keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={300} />
      <Field label={t('settings2.seerr.apiKey')} value={apiKey} onChangeText={setApiKey} placeholder={config.hasKey ? t('settings2.service.keyKept') : ''} secureTextEntry maxLength={200} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button label={t('settings2.service.save')} busy={save.isPending && save.variables?.url !== ''} disabled={!canSaveService(url, apiKey, config.hasKey)} onPress={() => save.mutate(serviceBody(url, apiKey))} />
        {on && (
          <SmallButton
            label={t('settings2.service.turnOff')}
            danger
            busy={save.isPending && save.variables?.url === ''}
            onPress={() => confirmThen(t('settings2.service.turnOffConfirm', { name: 'Seerr' }), t('settings2.service.turnOff'), t('common.cancel'), () => save.mutate({ url: '' }))}
          />
        )}
      </View>
    </Card>
  );
}

function ArrPanel({ service, config }: { service: ArrService; config: ServiceConfig }) {
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const failed = useFailed();
  const name = service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const itemsKey = [serverUrl, 'admin', 'arr', service, 'items'];
  const [url, setUrl] = useState(config.url);
  const [apiKey, setApiKey] = useState('');
  const [filter, setFilter] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => setUrl(config.url), [config.url]);
  const connected = config.hasKey && !!config.url;
  const items = useQuery({ queryKey: itemsKey, queryFn: () => api.get<{ items: ArrItem[] }>(`/api/admin/arr/${service}/items`), enabled: connected });
  const save = useMutation({
    mutationFn: (body: { url: string; apiKey?: string }) => api.put<ServiceConfig>(`/api/admin/arr/${service}`, body),
    onSuccess: (r) => {
      qc.setQueryData<ArrSettings>([serverUrl, 'admin', 'arr'], (prev) => (prev ? { ...prev, [service]: { url: r.url, hasKey: r.hasKey } } : prev));
      void qc.invalidateQueries({ queryKey: itemsKey });
      setUrl(r.url);
      setApiKey('');
      setVersion(r.version ?? null);
      dialog.alert('Vidalune', t(r.hasKey ? 'settings2.arr.saved' : 'settings2.arr.turnedOff'));
    },
    onError: failed,
  });
  const test = useMutation({
    mutationFn: () => api.post<{ version: string | null }>(`/api/admin/arr/${service}/test`),
    onSuccess: (r) => {
      setVersion(r.version);
      void items.refetch();
      dialog.alert('Vidalune', r.version ? t('settings2.arr.connectedVersion', { version: r.version }) : t('settings2.arr.connected'));
    },
    onError: (e) => {
      setVersion(null);
      failed(e);
    },
  });
  const remove = useMutation({
    mutationFn: ({ item, files }: { item: ArrItem; files: boolean }) => api.del(`/api/admin/arr/${service}/items/${item.id}?deleteFiles=${files}`),
    onSuccess: () => {
      void items.refetch();
      dialog.alert('Vidalune', t('settings2.arr.removed'));
    },
    onError: failed,
  });
  const askRemove = (item: ArrItem) =>
    dialog.alert('Vidalune', t('settings2.arr.confirmText', { title: item.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings2.arr.removeWithFiles'), style: 'destructive', onPress: () => remove.mutate({ item, files: true }) },
      { text: t('settings2.arr.remove'), style: 'destructive', onPress: () => remove.mutate({ item, files: false }) },
    ]);
  const list = items.data?.items ?? [];
  const shown = filterItems(list, filter);
  return (
    <Card title={name} right={connected ? <SmallButton label={t('settings2.arr.open')} onPress={() => void Linking.openURL(config.url)} /> : undefined}>
      <Text style={styles.muted}>{t(service === 'sonarr' ? 'settings2.arr.sonarrDescription' : 'settings2.arr.radarrDescription')}</Text>
      <Field label={t('settings2.arr.url', { name })} value={url} onChangeText={setUrl} placeholder="http://nas:8989" keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={300} />
      <Field label={t('settings2.arr.apiKey', { name })} value={apiKey} onChangeText={setApiKey} placeholder={config.hasKey ? t('settings2.service.keyKept') : ''} secureTextEntry maxLength={200} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button label={t('settings2.service.save')} busy={save.isPending && save.variables?.url !== ''} disabled={!canSaveService(url, apiKey, config.hasKey)} onPress={() => save.mutate(serviceBody(url, apiKey))} />
        {config.hasKey && <SmallButton label={t('settings2.arr.test')} busy={test.isPending} onPress={() => test.mutate()} />}
        {config.hasKey && (
          <SmallButton
            label={t('settings2.service.turnOff')}
            danger
            busy={save.isPending && save.variables?.url === ''}
            onPress={() => confirmThen(t('settings2.service.turnOffConfirm', { name }), t('settings2.service.turnOff'), t('common.cancel'), () => save.mutate({ url: '' }))}
          />
        )}
      </View>
      <Hint>{t('settings2.arr.keyPrivacy')}</Hint>
      {config.hasKey && (
        <View style={{ gap: 10 }}>
          {items.isError ? (
            <>
              <StatusLine text={t('settings2.arr.itemsError')} tone="danger" />
              <SmallButton label={t('common.retry')} onPress={() => void items.refetch()} />
            </>
          ) : items.data ? (
            <StatusLine text={version ? t('settings2.arr.connectedVersion', { version }) : t('settings2.arr.connected')} tone="ok" />
          ) : (
            <StatusLine text={t('settings2.arr.loadingItems')} />
          )}
          {list.length > 0 && <Field label={t('settings2.arr.filter')} value={filter} onChangeText={setFilter} autoCapitalize="none" autoCorrect={false} />}
          {items.data && shown.length === 0 && <Text style={styles.muted}>{filter ? t('settings2.arr.noMatches') : t('settings2.arr.noItems')}</Text>}
          {shown.map((item) => (
            <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={1}>
                  {item.title}
                  {item.year ? <Text style={styles.muted}> {item.year}</Text> : null}
                </Text>
                <Hint>
                  {item.status ?? t('settings2.arr.unknownStatus')} · {item.monitored ? t('settings2.arr.monitored') : t('settings2.arr.notMonitored')}
                </Hint>
              </View>
              <SmallButton label={t('settings2.arr.remove')} danger busy={remove.isPending && remove.variables?.item.id === item.id} onPress={() => askRemove(item)} />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
