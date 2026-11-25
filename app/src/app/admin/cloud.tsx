import { useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminScreen, Card, confirmThen, SmallButton } from '../../components/Admin';
import { Hint, StatusLine, useFailed } from '../../components/AdminSettings';
import { Button, ErrorState, Field, Loading, styles } from '../../components/ui';
import { directStep, parseNetworks, publicPort, relayLine, type CloudStatus, type DirectPortStatus } from '../../lib/adminSettings';
import { dialog } from '../../lib/dialog';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

/**
 * Admin → Vidalune account: linking (a code to enter on vidalune.com, opened in the browser), the relay,
 * home networks and the direct connection's public port.
 */
export default function CloudPage() {
  const { api, t, serverUrl, language } = useSession();
  const qc = useQueryClient();
  const failed = useFailed();
  const key = [serverUrl, 'admin', 'cloud'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<CloudStatus>('/api/admin/cloud') });
  const onDone = (s: CloudStatus) => qc.setQueryData(key, s);
  // While a code is shown, ask now and then whether it was entered.
  useQuery({
    queryKey: [...key, 'check'],
    queryFn: async () => {
      const s = await api.post<CloudStatus>('/api/admin/cloud/check');
      if (s.account) dialog.alert('Vidalune', t('settings2.cloud.linkedToast', { account: s.account }));
      onDone(s);
      return s;
    },
    enabled: !!q.data?.code,
    refetchInterval: 5000,
  });
  // While the relay is on but not connected, look again every few seconds.
  useQuery({
    queryKey: [...key, 'relay'],
    queryFn: async () => {
      const s = await api.get<CloudStatus>('/api/admin/cloud');
      onDone(s);
      return s;
    },
    enabled: !!q.data?.relay.enabled && !q.data.relay.connected,
    refetchInterval: 3000,
  });
  const link = useMutation({ mutationFn: () => api.post<CloudStatus>('/api/admin/cloud/link'), onSuccess: onDone, onError: failed });
  const relay = useMutation({ mutationFn: (enabled: boolean) => api.post<CloudStatus>('/api/admin/cloud/relay', { enabled }), onSuccess: onDone, onError: failed });
  const unlink = useMutation({
    mutationFn: (_quiet: boolean) => api.post<CloudStatus>('/api/admin/cloud/unlink'),
    onSuccess: (s, quiet) => {
      onDone(s);
      if (!quiet) dialog.alert('Vidalune', t('settings2.cloud.unlinked'));
    },
    onError: failed,
  });
  const [networks, setNetworks] = useState<string | null>(null);
  const saveNetworks = useMutation({
    mutationFn: (list: string[]) => api.put<CloudStatus>('/api/admin/cloud/home-networks', { networks: list }),
    onSuccess: (s) => {
      onDone(s);
      setNetworks(null);
      dialog.alert('Vidalune', t('settings2.cloud.homeSaved'));
    },
    onError: failed,
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const time = (ms: number) => new Date(ms).toLocaleTimeString(language === 'nl' ? 'nl-NL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const line = relayLine(s.relay);

  return (
    <AdminScreen title={t('admin.cloud')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Text style={styles.muted}>{t('settings2.cloud.intro')}</Text>
      <Hint>{t('settings2.cloud.shares')}</Hint>

      <Card>
        {s.account ? (
          <>
            <StatusLine text={t('settings2.cloud.linked', { account: s.account })} tone="ok" />
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <SmallButton label={t('settings2.cloud.manage')} onPress={() => void Linking.openURL(`${s.serviceUrl}/servers`)} />
              <SmallButton
                label={t('settings2.cloud.unlink')}
                danger
                busy={unlink.isPending}
                onPress={() => confirmThen(t('settings2.cloud.unlinkConfirm'), t('settings2.cloud.unlink'), t('common.cancel'), () => unlink.mutate(false))}
              />
            </View>
          </>
        ) : s.code ? (
          <>
            <Text style={[styles.body, { fontWeight: '600' }]}>{t('settings2.cloud.waitingTitle')}</Text>
            <Text style={{ color: colors.ink, fontSize: 36, fontWeight: '700', letterSpacing: 6, fontFamily: 'monospace' }} accessibilityLabel={s.code.code.split('').join(' ')} selectable>
              {s.code.code}
            </Text>
            <Text style={styles.muted}>
              {t('settings2.cloud.waitingHelp')} {t('settings2.cloud.expires', { time: time(s.code.expiresAt) })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <SmallButton label={t('settings2.cloud.openPage')} filled onPress={() => void Linking.openURL(s.code!.linkUrl)} />
              <SmallButton label={t('settings2.cloud.newCode')} busy={link.isPending} onPress={() => link.mutate()} />
              <SmallButton label={t('common.cancel')} onPress={() => unlink.mutate(true)} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.muted}>{t('settings2.cloud.off')}</Text>
            <Button label={t('settings2.cloud.link')} busy={link.isPending} onPress={() => link.mutate()} />
          </>
        )}
      </Card>

      {s.account && (
        <Card title={t('settings2.cloud.relayTitle')}>
          <Text style={styles.muted}>{t('settings2.cloud.relayIntro')}</Text>
          {!s.relay.allowed && <Text style={styles.muted}>{t('settings2.cloud.relaySubscription', { account: s.account })}</Text>}
          {s.relay.enabled && <StatusLine text={t(`settings2.cloud.relay.${line}`)} tone={line === 'connected' ? 'ok' : line === 'connecting' ? 'muted' : 'danger'} />}
          <SmallButton
            label={s.relay.enabled ? t('settings2.cloud.relayOff') : t('settings2.cloud.relayOn')}
            filled={!s.relay.enabled}
            busy={relay.isPending}
            disabled={!s.relay.enabled && !s.relay.allowed}
            onPress={() =>
              s.relay.enabled ? confirmThen(t('settings2.cloud.relayOffConfirm'), t('settings2.cloud.relayOff'), t('common.cancel'), () => relay.mutate(false)) : relay.mutate(true)
            }
          />
        </Card>
      )}

      <Card title={t('settings2.cloud.remoteTitle')}>
        <StatusLine text={s.remoteAccess ? t('settings2.cloud.remoteOn') : t('settings2.cloud.remoteOff')} tone={s.remoteAccess ? 'ok' : 'muted'} />
        <Hint>{t('settings2.cloud.remoteHint')}</Hint>
        <Text style={styles.label}>{t('settings2.cloud.homeNetworks')}</Text>
        <TextInput
          accessibilityLabel={t('settings2.cloud.homeNetworks')}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="100.64.0.0/10"
          placeholderTextColor={colors.faint}
          value={networks ?? s.homeNetworks.join('\n')}
          onChangeText={setNetworks}
          style={[styles.input, { height: undefined, minHeight: 80, paddingVertical: 10, fontFamily: 'monospace', fontSize: 14, textAlignVertical: 'top' }]}
        />
        <Hint>{t('settings2.cloud.homeNetworksHint')}</Hint>
        <SmallButton label={t('settings2.save')} busy={saveNetworks.isPending} disabled={networks === null} onPress={() => saveNetworks.mutate(parseNetworks(networks ?? ''))} />
      </Card>

      <DirectPanel access={s.directAccess} />
    </AdminScreen>
  );
}

function DirectPanel({ access }: { access: CloudStatus['directAccess'] }) {
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const failed = useFailed();
  const key = [serverUrl, 'admin', 'direct-port'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<DirectPortStatus>('/api/admin/direct-port') });
  const [port, setPort] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (publicPort: number) => api.put<DirectPortStatus>('/api/admin/direct-port', { publicPort }),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      setPort(null);
      dialog.alert('Vidalune', t('settings2.cloud.directSaved'));
    },
    onError: failed,
  });
  if (!q.data) return null;
  const p = q.data;
  const step = access ? directStep(access) : null;
  const submit = () => {
    const n = publicPort(port ?? '');
    if (n === null) return dialog.alert(t('common.error'), t('settings2.cloud.directPortInvalid'));
    save.mutate(n);
  };
  const ready = t('settings2.cloud.directReady');
  return (
    <Card title={t('settings2.cloud.directTitle')}>
      <Text style={styles.muted}>{t('settings2.cloud.directIntro', { port: p.internalPort })}</Text>
      {access && (
        <View style={{ gap: 4 }}>
          <Text style={styles.body}>
            {t('settings2.cloud.directDns')}: {!access.configured ? t('settings2.cloud.directNotConfigured') : access.dnsReady ? ready : t('settings2.cloud.directWaiting')}
          </Text>
          <Text style={styles.body}>
            {t('settings2.cloud.directTls')}: {access.tlsReady ? ready : t('settings2.cloud.directWaiting')}
          </Text>
          <Text style={styles.body}>
            {t('settings2.cloud.directReachability')}: {access.portOpen ? ready : t('settings2.cloud.directNotReachable')}
          </Text>
          <StatusLine
            text={step ? t(`settings2.cloud.step.${step}`, { publicPort: p.publicPort, internalPort: p.internalPort }) : ready}
            tone={step ? 'warn' : 'ok'}
          />
        </View>
      )}
      <Field label={t('settings2.cloud.directPort')} value={port ?? String(p.publicPort)} keyboardType="number-pad" maxLength={5} onChangeText={setPort} />
      {port !== null && <SmallButton label={t('settings2.save')} filled busy={save.isPending} onPress={submit} />}
    </Card>
  );
}
