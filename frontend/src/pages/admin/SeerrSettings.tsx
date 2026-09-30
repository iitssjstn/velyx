import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

interface SeerrConfig {
  url: string;
  hasKey: boolean;
  version?: string | null;
}

/** Admin → Server: the optional connection to Seerr (the key is never shown again). */
export function SeerrSettings() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'seerr'], queryFn: () => api.get<SeerrConfig>('/api/admin/seerr') });
  const [url, setUrl] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { url: string; apiKey?: string }) => api.put<SeerrConfig>('/api/admin/seerr', body),
    onSuccess: (d) => {
      qc.setQueryData(['admin', 'seerr'], d);
      void qc.invalidateQueries({ queryKey: ['seerr'] });
      setUrl(null);
      setApiKey('');
      setVersion(d.version ?? null);
      toast.success(d.hasKey ? t('requests.admin.saved') : t('requests.admin.removed'));
    },
    onError: (e) => toast.error(e),
  });
  if (!q.data) return null;
  const d = q.data;
  const on = !!d.url && d.hasKey;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ url: (url ?? d.url).trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
  };
  return (
    <section className="panel space-y-4 p-5 sm:p-6" aria-labelledby="seerr-title">
      <div>
        <h2 id="seerr-title" className="font-display text-lg font-semibold">{t('requests.admin.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('requests.admin.description')}</p>
      </div>
      <p className="text-sm" role="status">
        {on ? <span className="text-ok">{version ? t('requests.admin.onVersion', { version, url: d.url }) : t('requests.admin.on', { url: d.url })}</span> : <span className="text-muted">{t('requests.admin.off')}</span>}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="seerr-url">{t('requests.admin.url')}</label>
          <input id="seerr-url" className="input" type="url" autoComplete="off" spellCheck={false} maxLength={300} placeholder={t('requests.admin.urlPlaceholder')} value={url ?? d.url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="seerr-key">{t('requests.admin.apiKey')}</label>
          <input id="seerr-key" className="input font-mono text-sm" type="password" autoComplete="off" spellCheck={false} maxLength={200} placeholder={d.hasKey ? t('requests.admin.keyKept') : ''} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending && save.variables?.url !== ''} disabled={!(url ?? d.url).trim() || (!d.hasKey && !apiKey.trim())}>{t('requests.admin.save')}</Button>
          {on && <Button variant="ghost" onClick={() => save.mutate({ url: '' })}>{t('requests.admin.turnOff')}</Button>}
        </div>
      </form>
    </section>
  );
}
