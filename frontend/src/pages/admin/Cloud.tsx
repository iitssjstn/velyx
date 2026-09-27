import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, ExternalLink, RefreshCw, Unlink } from 'lucide-react';
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
}

const KEY = ['admin', 'cloud'];

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

      <ConfirmModal open={confirming} title={t('cloud.unlinkTitle')} confirmLabel={t('cloud.unlink')} danger loading={unlink.isPending} onConfirm={() => unlink.mutate()} onClose={() => setConfirming(false)}>
        {t('cloud.unlinkConfirm')}
      </ConfirmModal>
    </div>
  );
}
