import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cloud, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from './Button';
import { toast } from './Toast';
import { useT } from '../i18n';
import { serversPage } from '../lib/vidalune';

export interface AccountCloud {
  /** This server is linked to Vidalune: its users can connect their own Vidalune account. */
  available: boolean;
  email: string | null;
  appUrl: string | null;
  reachable?: boolean;
}

const KEY = ['account', 'cloud'];

/**
 * Settings → Account: connect your own Vidalune account to your user here, to sign in from
 * app.vidalune.com and the app without a password. Only shown when the server is linked.
 */
export function VidaluneAccount() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<AccountCloud>('/api/account/cloud'), refetchInterval: (query) => (query.state.data?.available && !query.state.data.email ? 5000 : false) });
  const link = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: number; linkUrl: string }>('/api/account/cloud/link'),
    // The account page opens with the code filled in.
    onSuccess: (r) => window.open(r.linkUrl, '_blank', 'noopener'),
    onError: (e) => toast.error(e),
  });
  const unlink = useMutation({
    mutationFn: () => api.post('/api/account/cloud/unlink'),
    onSuccess: () => {
      toast.success(t('settings.vidalune.unlinked'));
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(e),
  });
  const s = q.data;
  if (!s?.available) return null;
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="vidalune-account">
      <h2 id="vidalune-account" className="flex items-center gap-2 font-display text-lg font-semibold">
        <Cloud className="size-5 text-accent" aria-hidden="true" />
        {t('settings.vidalune.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('settings.vidalune.intro')}</p>
      <div className="mt-5 space-y-3" aria-live="polite">
        {s.email ? (
          <>
            <p>{t('settings.vidalune.connected', { email: s.email })}</p>
            <div className="flex flex-wrap gap-2">
              {s.appUrl && (
                <a className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-accent hover:bg-raised" href={serversPage(s.appUrl)}>
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t('settings.vidalune.open')}
                </a>
              )}
              <Button variant="ghost" size="sm" loading={unlink.isPending} onClick={() => unlink.mutate()}>{t('settings.vidalune.unlink')}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">{t('settings.vidalune.how')}</p>
            <Button size="sm" loading={link.isPending} onClick={() => link.mutate()}>{t('settings.vidalune.connect')}</Button>
            {link.data && <p className="text-sm text-muted">{t('settings.vidalune.waiting', { code: link.data.code })}</p>}
          </>
        )}
      </div>
    </section>
  );
}
