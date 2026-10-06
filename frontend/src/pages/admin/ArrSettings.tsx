import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Film, RefreshCw, Search, Tv, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/Modal';
import { ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

type ArrService = 'sonarr' | 'radarr';
interface ArrConfig { url: string; hasKey: boolean }
interface ArrItem { id: number; title: string; year: number | null; monitored: boolean; status: string | null }
interface ArrSettings { sonarr: ArrConfig; radarr: ArrConfig }
interface SavedArrConfig extends ArrConfig { version: string | null }

const SERVICES: Array<{ key: ArrService; title: 'arr.sonarr' | 'arr.radarr'; description: 'arr.sonarrDescription' | 'arr.radarrDescription'; kind: 'series' | 'movies' }> = [
  { key: 'sonarr', title: 'arr.sonarr', description: 'arr.sonarrDescription', kind: 'series' },
  { key: 'radarr', title: 'arr.radarr', description: 'arr.radarrDescription', kind: 'movies' },
];

export function ArrSettingsPage() {
  const { t } = useT();
  const q = useQuery({ queryKey: ['admin', 'arr'], queryFn: () => api.get<ArrSettings>('/api/admin/arr') });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{t('arr.intro')}</p>
      {SERVICES.map((service) => <ArrServicePanel key={service.key} service={service} config={q.data[service.key]} />)}
    </div>
  );
}

function ArrServicePanel({ service, config }: { service: (typeof SERVICES)[number]; config: ArrConfig }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [url, setUrl] = useState(config.url);
  const [apiKey, setApiKey] = useState('');
  const [filter, setFilter] = useState('');
  const [testedVersion, setTestedVersion] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ArrItem | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  useEffect(() => setUrl(config.url), [config.url]);

  const items = useQuery({
    queryKey: ['admin', 'arr', service.key, 'items'],
    queryFn: () => api.get<{ items: ArrItem[] }>(`/api/admin/arr/${service.key}/items`),
    enabled: config.hasKey && Boolean(config.url),
  });
  const saved = useMutation({
    mutationFn: (body: { url: string; apiKey?: string }) => api.put<SavedArrConfig>(`/api/admin/arr/${service.key}`, body),
    onSuccess: (result) => {
      qc.setQueryData<ArrSettings>(['admin', 'arr'], (previous) => previous ? { ...previous, [service.key]: { url: result.url, hasKey: result.hasKey } } : previous);
      void qc.invalidateQueries({ queryKey: ['admin', 'arr', service.key, 'items'] });
      setUrl(result.url);
      setApiKey('');
      setTestedVersion(result.version);
      toast.success(result.hasKey ? t('arr.saved') : t('arr.turnedOff'));
    },
    onError: (error) => toast.error(error),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ version: string | null }>(`/api/admin/arr/${service.key}/test`),
    onSuccess: (result) => {
      setTestedVersion(result.version);
      void items.refetch();
      toast.success(t('arr.connected'));
    },
    onError: (error) => { setTestedVersion(null); toast.error(error); },
  });
  const remove = useMutation({
    mutationFn: ({ item, files }: { item: ArrItem; files: boolean }) => api.del(`/api/admin/arr/${service.key}/items/${item.id}?deleteFiles=${files}`),
    onSuccess: () => {
      setRemoving(null);
      setDeleteFiles(false);
      void items.refetch();
      toast.success(t('arr.removed'));
    },
    onError: (error) => toast.error(error),
  });
  const list = items.data?.items ?? [];
  const shown = list.filter((item) => item.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const Icon = service.kind === 'series' ? Tv : Film;

  return (
    <section className="panel space-y-4 p-5 sm:p-6" aria-labelledby={`${service.key}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${service.key}-title`} className="flex items-center gap-2 font-display text-lg font-semibold">
            <Icon className="size-5 text-accent" aria-hidden="true" />{t(service.title)}
          </h2>
          <p className="mt-1 text-sm text-muted">{t(service.description)}</p>
        </div>
        {config.hasKey && config.url && (
          <a href={config.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted hover:bg-raised hover:text-ink">
            {t('arr.open')}<ExternalLink className="size-4" aria-hidden="true" />
          </a>
        )}
      </header>

      <form onSubmit={(event) => { event.preventDefault(); saved.mutate({ url: url.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }); }} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label className="label" htmlFor={`${service.key}-url`}>{t(service.title)} {t('arr.url')}</label>
          <input id={`${service.key}-url`} type="url" className="input" autoComplete="url" maxLength={300} placeholder={t('arr.urlPlaceholder')} value={url} onChange={(event) => setUrl(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`${service.key}-key`}>{t(service.title)} {t('arr.apiKey')}</label>
          <input id={`${service.key}-key`} type="password" className="input font-mono text-sm" autoComplete="new-password" maxLength={200} placeholder={config.hasKey ? t('arr.keyKept') : ''} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={saved.isPending} disabled={!url.trim() || (!config.hasKey && !apiKey.trim())}>{t('arr.save')}</Button>
          {config.hasKey && <Button type="button" size="sm" variant="secondary" loading={test.isPending} icon={<RefreshCw className="size-4" />} onClick={() => test.mutate()}>{t('arr.test')}</Button>}
          {config.hasKey && <Button type="button" size="sm" variant="ghost" loading={saved.isPending} onClick={() => { setUrl(''); setApiKey(''); saved.mutate({ url: '' }); }}>{t('arr.turnOff')}</Button>}
        </div>
      </form>

      <p className="text-xs text-faint">{t('arr.keyPrivacy')}</p>
      {config.hasKey && (
        <div className="border-t border-line/60 pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm" role="status">
              {items.isError ? <span className="text-danger">{t('arr.unreachable')}</span> : items.data ? <span className="text-ok">{testedVersion ? t('arr.connectedVersion', { version: testedVersion }) : t('arr.connected')}</span> : <span className="text-muted">{t('arr.loadingItems')}</span>}
            </div>
            {list.length > 0 && (
              <label className="relative block w-full sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
                <input className="input pl-9" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('arr.filter')} aria-label={t('arr.filter')} />
              </label>
            )}
          </div>
          {items.isLoading ? <p className="py-5 text-sm text-muted">{t('arr.loadingItems')}</p> : items.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger">
              <span>{t('arr.itemsError')}</span>
              <Button size="sm" variant="ghost" onClick={() => void items.refetch()}>{t('arr.retry')}</Button>
            </div>
          ) : shown.length === 0 ? <p className="py-5 text-sm text-muted">{filter ? t('arr.noMatches') : t('arr.noItems')}</p> : (
            <ul className="divide-y divide-line/50">
              {shown.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.title}{item.year ? <span className="ml-2 text-sm font-normal text-muted">{item.year}</span> : null}</p>
                    <p className="text-xs text-faint">{item.status ?? t('arr.unknownStatus')} · {item.monitored ? t('arr.monitored') : t('arr.notMonitored')}</p>
                  </div>
                  <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => { setRemoving(item); setDeleteFiles(false); }}>{t('arr.remove')}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmModal
        open={!!removing}
        title={t('arr.confirmTitle')}
        confirmLabel={t('arr.remove')}
        danger
        loading={remove.isPending}
        onClose={() => { setRemoving(null); setDeleteFiles(false); }}
        onConfirm={() => { if (removing) remove.mutate({ item: removing, files: deleteFiles }); }}
      >
        <p>{t('arr.confirmText', { title: removing?.title ?? '' })}</p>
        <label className="mt-4 flex items-start gap-3 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} />
          <span>{t('arr.deleteFiles')}</span>
        </label>
      </ConfirmModal>
    </section>
  );
}