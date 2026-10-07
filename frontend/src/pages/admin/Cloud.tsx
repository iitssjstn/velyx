import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, ExternalLink, House, Network, Radio, RefreshCw, Unlink } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/Modal';
import { ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

export interface CloudStatus {
  enabled: boolean;
  account: string | null;
  code: { code: string; expiresAt: number; linkUrl: string } | null;
  serviceUrl: string;
  directAccess: { configured: boolean; hostname: string; port: number; dnsReady: boolean; tlsReady: boolean; portOpen: boolean; checkedAt: number | null; url: string | null } | null;
  relay: { enabled: boolean; url: string | null; connected: boolean; error: 'refused' | 'subscription' | 'unreachable' | 'closed' | null; allowed: boolean };
  /** Playing away from home works (linked, and the owner has remote access). */
  remoteAccess: boolean;
  /** Networks that also count as home. */
  homeNetworks: string[];
}

export interface UpnpStatus {
  enabled: boolean;
  externalPort: number;
  open: boolean;
  address: string | null;
  problem: 'noRouter' | 'refused' | 'failed' | null;
  checkedAt: number | null;
}

const KEY = ['admin', 'cloud'];

/** Opening a port on the router with UPnP (opt-in). */
function UpnpSection() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'upnp'], queryFn: () => api.get<UpnpStatus>('/api/admin/upnp') });
  const [port, setPort] = useState<string | null>(null);
  const done = (s: UpnpStatus) => {
    qc.setQueryData(['admin', 'upnp'], s);
    setPort(null);
  };
  const save = useMutation({ mutationFn: (body: { enabled: boolean; externalPort: number }) => api.put<UpnpStatus>('/api/admin/upnp', body), onSuccess: done, onError: (e) => toast.error(e) });
  const check = useMutation({ mutationFn: () => api.post<UpnpStatus>('/api/admin/upnp/check'), onSuccess: done, onError: (e) => toast.error(e) });
  if (!q.data) return null;
  const u = q.data;
  const chosen = Number(port ?? u.externalPort);
  const valid = Number.isInteger(chosen) && chosen >= 1024 && chosen <= 65535;
  return (
    <section className="panel space-y-3 p-5" aria-labelledby="upnp-title">
      <h2 id="upnp-title" className="flex items-center gap-2 font-display text-lg font-semibold">
        <Network className="size-5 text-accent" aria-hidden="true" />
        {t('cloud.upnpTitle')}
      </h2>
      <p className="text-sm text-muted">{t('cloud.upnpIntro')}</p>
      {u.enabled && (
        <p className={u.open ? 'text-sm text-ok' : 'text-sm text-danger'} role="status">
          {u.open ? (u.address ? t('cloud.upnpOpen', { address: u.address }) : t('cloud.upnpOpenNoAddress', { port: u.externalPort })) : u.problem ? t(`cloud.upnpProblem.${u.problem}`) : null}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="upnp-port">{t('cloud.upnpPort')}</label>
          <input id="upnp-port" className="input w-32" type="number" min={1024} max={65535} value={port ?? String(u.externalPort)} onChange={(e) => setPort(e.target.value)} />
        </div>
        {u.enabled && port !== null && (
          <Button size="sm" variant="secondary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate({ enabled: true, externalPort: chosen })}>{t('common.save')}</Button>
        )}
        <Button size="sm" variant={u.enabled ? 'secondary' : 'primary'} disabled={!valid} loading={save.isPending} onClick={() => save.mutate({ enabled: !u.enabled, externalPort: chosen })}>
          {u.enabled ? t('cloud.upnpOff') : t('cloud.upnpOn')}
        </Button>
        {u.enabled && (
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={check.isPending} onClick={() => check.mutate()}>{t('cloud.upnpCheck')}</Button>
        )}
      </div>
    </section>
  );
}

/** Admin → Vidalune account: link this server to an account (opt-in). */
export function CloudPage() {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<CloudStatus>('/api/admin/cloud') });
  const waiting = !!q.data?.code;
  // While a code is shown, ask the account service now and then whether it was entered.
  useQuery({
    queryKey: [...KEY, 'check'],
    queryFn: async () => {
      const s = await api.post<CloudStatus>('/api/admin/cloud/check');
      if (s.account) toast.success(t('cloud.linkedToast', { account: s.account }));
      qc.setQueryData(KEY, s);
      return s;
    },
    enabled: waiting,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const onDone = (s: CloudStatus) => qc.setQueryData(KEY, s);
  const link = useMutation({ mutationFn: () => api.post<CloudStatus>('/api/admin/cloud/link'), onSuccess: onDone, onError: (e) => toast.error(e) });
  const relay = useMutation({ mutationFn: (enabled: boolean) => api.post<CloudStatus>('/api/admin/cloud/relay', { enabled }), onSuccess: onDone, onError: (e) => toast.error(e) });
  // While the relay is on but not (yet) connected, look again every few seconds.
  useQuery({
    queryKey: [...KEY, 'relay'],
    queryFn: async () => {
      const s = await api.get<CloudStatus>('/api/admin/cloud');
      qc.setQueryData(KEY, s);
      return s;
    },
    enabled: !!q.data?.relay.enabled && !q.data.relay.connected,
    refetchInterval: 3000,
  });
  const [networks, setNetworks] = useState<string | null>(null);
  const saveNetworks = useMutation({
    mutationFn: (list: string[]) => api.put<CloudStatus>('/api/admin/cloud/home-networks', { networks: list }),
    onSuccess: (s) => {
      onDone(s);
      setNetworks(null);
      toast.success(t('cloud.homeSaved'));
    },
    onError: (e) => toast.error(e),
  });
  const unlink = useMutation({
    mutationFn: () => api.post<CloudStatus>('/api/admin/cloud/unlink'),
    onSuccess: (s) => {
      onDone(s);
      setConfirming(false);
      toast.success(t('cloud.unlinked'));
    },
    onError: (e) => toast.error(e),
  });

  if (q.isLoading) return <PageLoader />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const time = (ms: number) => new Date(ms).toLocaleTimeString(lang === 'nl' ? 'nl-NL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <p className="text-muted">{t('cloud.intro')}</p>
        <p className="text-xs text-faint">{t('cloud.shares')}</p>
      </div>

      <section className="panel space-y-4 p-5" aria-live="polite">
        {s.account ? (
          <>
            <p className="flex items-center gap-2 font-medium">
              <Cloud className="size-5 text-accent" aria-hidden="true" />
              {t('cloud.linked', { account: s.account })}
            </p>
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-accent hover:bg-raised" href={`${s.serviceUrl}/servers`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden="true" />
                {t('cloud.manage')}
              </a>
              <Button variant="ghost" size="sm" icon={<Unlink className="size-4" />} onClick={() => setConfirming(true)}>{t('cloud.unlink')}</Button>
            </div>
          </>
        ) : s.code ? (
          <>
            <h2 className="font-display text-lg font-semibold">{t('cloud.waitingTitle')}</h2>
            <p className="font-mono text-4xl font-semibold tracking-[0.2em]" aria-label={s.code.code.split('').join(' ')}>{s.code.code}</p>
            <p className="text-sm text-muted">{t('cloud.waitingHelp')} {t('cloud.expires', { time: time(s.code.expiresAt) })}</p>
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink" href={s.code.linkUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden="true" />
                {t('cloud.openPage')}
              </a>
              <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} loading={link.isPending} onClick={() => link.mutate()}>{t('cloud.newCode')}</Button>
              <Button variant="ghost" size="sm" onClick={() => unlink.mutate()}>{t('common.cancel')}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">{t('cloud.off')}</p>
            <Button icon={<Cloud className="size-4" />} loading={link.isPending} onClick={() => link.mutate()}>{t('cloud.link')}</Button>
          </>
        )}
      </section>

      {s.account && (
        <section className="panel space-y-3 p-5" aria-labelledby="direct-access-title">
          <h2 id="direct-access-title" className="font-display text-lg font-semibold">{t('cloud.directTitle')}</h2>
          <p className="text-sm text-muted">{t('cloud.directIntro', { port: s.directAccess?.port ?? 8443 })}</p>
          {!s.directAccess ? (
            <p className="text-sm text-muted" role="status">{t('cloud.directWaiting')}</p>
          ) : !s.directAccess.configured ? (
            <p className="text-sm text-danger" role="status">{t('cloud.directNotConfigured')}</p>
          ) : (
            <div className="space-y-1 text-sm" aria-live="polite">
              <p>{t('cloud.directDns')}: {s.directAccess.dnsReady ? t('cloud.directReady') : t('cloud.directPending')}</p>
              <p>{t('cloud.directTls')}: {s.directAccess.tlsReady ? t('cloud.directReady') : t('cloud.directPending')}</p>
              <p>{t('cloud.directPort')}: {s.directAccess.portOpen ? t('cloud.directReady') : t('cloud.directPortClosed', { port: s.directAccess.port })}</p>
              {s.directAccess.url && <p className="font-mono text-xs text-ok">{s.directAccess.url}</p>}
            </div>
          )}
        </section>
      )}

      {s.account && (
        <section className="panel space-y-3 p-5" aria-labelledby="relay-title">
          <h2 id="relay-title" className="flex items-center gap-2 font-display text-lg font-semibold">
            <Radio className="size-5 text-accent" aria-hidden="true" />
            {t('cloud.relayTitle')}
          </h2>
          <p className="text-sm text-muted">{t('cloud.relayIntro')}</p>
          <p className="text-xs text-faint">{t('cloud.relayPrivacy')}</p>
          {!s.relay.allowed && (
            <p className="rounded-lg border border-line bg-raised px-3 py-2 text-sm text-muted" role="status">
              {t('cloud.relaySubscription', { account: s.account })}
            </p>
          )}
          {s.relay.enabled && (
            <div className="space-y-1 text-sm" aria-live="polite">
              {s.relay.url && <p>{t('cloud.relayReachable')}</p>}
              <p className={s.relay.connected ? 'text-ok' : s.relay.error ? 'text-danger' : 'text-muted'}>
                {s.relay.connected ? t('cloud.relayConnected') : s.relay.error ? t(`cloud.relayProblem.${s.relay.error}`) : t('cloud.relayConnecting')}
              </p>
            </div>
          )}
          <Button variant={s.relay.enabled ? 'secondary' : 'primary'} size="sm" loading={relay.isPending} disabled={!s.relay.enabled && !s.relay.allowed} onClick={() => relay.mutate(!s.relay.enabled)}>
            {s.relay.enabled ? t('cloud.relayOff') : t('cloud.relayOn')}
          </Button>
        </section>
      )}

      <section className="panel space-y-3 p-5" aria-labelledby="remote-title">
        <h2 id="remote-title" className="flex items-center gap-2 font-display text-lg font-semibold">
          <House className="size-5 text-accent" aria-hidden="true" />
          {t('cloud.remoteTitle')}
        </h2>
        <p className={s.remoteAccess ? 'text-sm text-ok' : 'text-sm text-muted'} role="status">
          {s.remoteAccess ? t('cloud.remoteOn') : t('cloud.remoteOff')}
        </p>
        <p className="text-xs text-faint">{t('cloud.remoteHint')}</p>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveNetworks.mutate((networks ?? '').split(/[\s,]+/).map((n) => n.trim()).filter(Boolean));
          }}
        >
          <label className="label" htmlFor="home-networks">{t('cloud.homeNetworks')}</label>
          <textarea
            id="home-networks"
            className="input min-h-20 font-mono text-sm"
            placeholder="100.64.0.0/10"
            value={networks ?? s.homeNetworks.join('\n')}
            onChange={(e) => setNetworks(e.target.value)}
          />
          <p className="text-xs text-faint">{t('cloud.homeNetworksHint')}</p>
          <Button type="submit" size="sm" variant="secondary" loading={saveNetworks.isPending} disabled={networks === null}>{t('common.save')}</Button>
        </form>
      </section>

      <UpnpSection />

      <ConfirmModal open={confirming} title={t('cloud.unlinkTitle')} confirmLabel={t('cloud.unlink')} danger loading={unlink.isPending} onConfirm={() => unlink.mutate()} onClose={() => setConfirming(false)}>
        {t('cloud.unlinkConfirm')}
      </ConfirmModal>
    </div>
  );
}
