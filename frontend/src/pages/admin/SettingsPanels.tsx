import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ServerSettings } from '../../lib/types';
import { intervalLabel } from '../../lib/format';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';
import { useT } from '../../i18n';
import { useServerSettings } from './useServerSettings';

/*
 * The parts of the server settings that belong on a page of their own subject (scanning on Libraries,
 * metadata on Metadata, and so on). Each panel saves only its own fields.
 */

const INTERVALS = [0, 60, 180, 360, 720, 1440];

function Check({ checked, onChange, label, hint, disabled, indent, children }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean; indent?: boolean; children?: ReactNode }) {
  return (
    <label className={`flex items-start gap-3 text-sm ${indent ? 'pl-7' : ''}`}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-faint">{hint}</span>}
        {children}
      </span>
    </label>
  );
}

/** Loads the settings and keeps a form of the fields one panel edits. */
function usePanel<T extends object>(pick: (s: ServerSettings) => T) {
  const { query, save } = useServerSettings();
  const [form, setForm] = useState<T | null>(null);
  useEffect(() => {
    if (query.data) setForm(pick(query.data));
    // `pick` is a fixed field list per panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);
  return { query, save, form, setForm };
}

function PanelState({ query }: { query: ReturnType<typeof useServerSettings>['query'] }) {
  // Loaded, but the form is filled in by the effect right after this render.
  if (query.data) return null;
  if (query.isLoading) return <PageLoader />;
  return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
}

/** Libraries: when and how the libraries are scanned. */
export function ScanSettings() {
  const { t } = useT();
  const { query, save, form, setForm } = usePanel((s) => ({
    interval: s.scanIntervalSource === 'settings' ? String(s.scanIntervalMinutes) : '',
    watchFolders: s.watchFolders,
    scanOnStartup: s.scanOnStartup,
    deferScansWhilePlaying: s.deferScansWhilePlaying,
  }));
  if (!query.data || !form) return <PanelState query={query} />;
  const s = query.data;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { interval, ...rest } = form;
    // '' = use SCAN_INTERVAL_MINUTES from the environment
    save.mutate({ ...rest, scanIntervalMinutes: interval === '' ? null : Number(interval) });
  };
  return (
    <form onSubmit={submit} className="panel space-y-4 p-5 sm:p-6" aria-labelledby="scan-settings-title">
      <h2 id="scan-settings-title" className="font-display text-lg font-semibold">{t('server.scanning')}</h2>
      <p className="text-sm text-muted">{t('server.scanningText')}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="interval">{t('dashboard.scheduledScans')}</label>
          <select id="interval" className="input" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })}>
            <option value="">{t('server.intervalDefault', { interval: intervalLabel(s.scanIntervalDefault).toLowerCase() })}</option>
            {INTERVALS.map((m) => (
              <option key={m} value={m}>{intervalLabel(m)}</option>
            ))}
            {form.interval !== '' && !INTERVALS.includes(Number(form.interval)) && <option value={form.interval}>{intervalLabel(Number(form.interval))}</option>}
          </select>
          <p className="mt-1 text-xs text-faint">{t('server.intervalHint')}</p>
        </div>
      </div>
      <Check checked={form.watchFolders} onChange={(v) => setForm({ ...form, watchFolders: v })} label={t('server.watchFolders')} hint={t('server.watchFoldersHint')} />
      <Check checked={form.scanOnStartup} onChange={(v) => setForm({ ...form, scanOnStartup: v })} label={t('server.scanOnStartup')} hint={t('server.scanOnStartupHint')} />
      <Check checked={form.deferScansWhilePlaying} onChange={(v) => setForm({ ...form, deferScansWhilePlaying: v })} label={t('server.defer')} hint={t('server.deferHint')} />
      <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
    </form>
  );
}

/** Metadata: where it comes from (TMDB and its key) and in which language. The key is write-only. */
export function MetadataSettings() {
  const { t, tRich } = useT();
  const { query, save, form, setForm } = usePanel((s) => ({ tmdbLanguage: s.tmdbLanguage, includeAdult: s.includeAdult }));
  const [key, setKey] = useState('');
  if (!query.data || !form) return <PanelState query={query} />;
  const s = query.data;
  const savingKey = save.isPending && 'tmdbApiKey' in (save.variables ?? {});
  return (
    <section className="panel space-y-5 p-5 sm:p-6" aria-labelledby="tmdb-title">
      <div>
        <h2 id="tmdb-title" className="font-display text-lg font-semibold">{t('server.tmdbTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('server.tmdbText')}</p>
      </div>
      <p className="text-sm">
        {t('server.status')}{' '}
        {s.tmdb.configured ? (
          <span className="text-ok">
            {tRich(s.tmdb.source === 'environment' ? 'server.configuredEnv' : 'server.configuredSettings', { hint: s.tmdb.hint ? <span className="font-mono">{s.tmdb.hint}</span> : '' })}
          </span>
        ) : s.tmdb.via === 'vidalune' ? (
          <span className="text-ok">{t('server.tmdbVidalune')}</span>
        ) : (
          <span className="text-amber">{s.tmdb.linked ? t('server.tmdbVidaluneOff') : t('server.notConfigured')}</span>
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) save.mutate({ tmdbApiKey: key.trim() }, { onSuccess: () => setKey('') });
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          className="input min-w-0 flex-1 font-mono text-sm"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={s.tmdb.configured ? t('server.newKey') : t('server.keyPlaceholder')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label={t('setup.tmdbKey')}
        />
        <Button type="submit" disabled={!key.trim()} loading={savingKey}>
          {t('server.verifySave')}
        </Button>
        {s.tmdb.source === 'settings' && (
          <Button variant="ghost" onClick={() => save.mutate({ tmdbApiKey: '' })}>
            {t('server.removeKey')}
          </Button>
        )}
      </form>
      {s.tmdb.source === 'environment' && <p className="text-xs text-faint">{t('server.keyPriority')}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ tmdbLanguage: form.tmdbLanguage.trim(), includeAdult: form.includeAdult });
        }}
        className="space-y-4 border-t border-line/60 pt-5"
      >
        <div className="max-w-sm">
          <label className="label" htmlFor="lang">{t('server.metadataLanguage')}</label>
          <input id="lang" className="input" placeholder="en-US" value={form.tmdbLanguage} onChange={(e) => setForm({ ...form, tmdbLanguage: e.target.value })} />
          <p className="mt-1 text-xs text-faint">{t('server.metadataLanguageHint')}</p>
        </div>
        <Check checked={form.includeAdult} onChange={(v) => setForm({ ...form, includeAdult: v })} label={t('server.includeAdult')} />
        <Button type="submit" loading={save.isPending && !savingKey}>{t('common.save')}</Button>
      </form>
    </section>
  );
}

/** Intros & credits: whether and how they are detected. */
export function DetectionSettings() {
  const { t } = useT();
  const { query, save, form, setForm } = usePanel((s) => ({ segmentDetection: s.segmentDetection, segmentVideo: s.segmentVideo, sharedDetection: s.sharedDetection }));
  if (!query.data || !form) return <PanelState query={query} />;
  return (
    <form
      id="detection-settings"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
      className="panel space-y-4 p-5 sm:p-6"
      aria-labelledby="detection-settings-title"
    >
      <h2 id="detection-settings-title" className="font-display text-lg font-semibold">{t('segments.settingsTitle')}</h2>
      <Check checked={form.segmentDetection} onChange={(v) => setForm({ ...form, segmentDetection: v })} label={t('server.segments')} hint={t('server.segmentsHint')} />
      <Check indent checked={form.segmentVideo} disabled={!form.segmentDetection} onChange={(v) => setForm({ ...form, segmentVideo: v })} label={t('server.segmentVideo')} hint={t('server.segmentVideoHint')} />
      <Check indent checked={form.sharedDetection} disabled={!form.segmentDetection} onChange={(v) => setForm({ ...form, sharedDetection: v })} label={t('server.sharedDetection')} hint={t('server.sharedDetectionHint')} />
      <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
    </form>
  );
}

/** Maintenance: when background work may run, and what it prepares ahead of time. */
export function MaintenancePage() {
  const { t } = useT();
  const { query, save, form, setForm } = usePanel((s) => ({ maintenanceStart: s.maintenanceStart, maintenanceEnd: s.maintenanceEnd, maintenanceOutside: s.maintenanceOutside, subtitlePrefetch: s.subtitlePrefetch }));
  if (!query.data || !form) return <PanelState query={query} />;
  const s = query.data;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
      className="panel space-y-4 p-5 sm:p-6"
      aria-labelledby="maintenance-title"
    >
      <h2 id="maintenance-title" className="font-display text-lg font-semibold">{t('server.maintenance')}</h2>
      <p className="text-sm text-muted">{t('server.maintenanceText')}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="mstart">{t('server.maintenanceStart')}</label>
          <input id="mstart" type="time" className="input" required value={form.maintenanceStart} onChange={(e) => setForm({ ...form, maintenanceStart: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="mend">{t('server.maintenanceEnd')}</label>
          <input id="mend" type="time" className="input" required value={form.maintenanceEnd} onChange={(e) => setForm({ ...form, maintenanceEnd: e.target.value })} />
        </div>
      </div>
      <p className="text-xs text-faint">{t('server.maintenanceServerTime', { time: s.serverTime, zone: s.serverTimeZone })}</p>
      <Check checked={form.maintenanceOutside} onChange={(v) => setForm({ ...form, maintenanceOutside: v })} label={t('server.maintenanceOutside')} hint={t('server.maintenanceOutsideHint')} />
      <Check checked={form.subtitlePrefetch} onChange={(v) => setForm({ ...form, subtitlePrefetch: v })} label={t('server.subtitlePrefetch')} hint={t('server.subtitlePrefetchHint')}>
        {s.subtitlePrefetch && (
          <span className="block text-xs text-muted">
            {s.subtitlePrefetchStatus.pending > 0 ? t('server.subtitlePrefetchPending', { count: s.subtitlePrefetchStatus.pending }) : t('server.subtitlePrefetchDone')}
          </span>
        )}
        {s.subtitlePrefetch && s.subtitlePrefetchStatus.pending > 0 && s.subtitlePrefetchStatus.waitingFor === 'window' && (
          <span className="block text-xs text-muted">{t('server.subtitlePrefetchWaitsForWindow')}</span>
        )}
      </Check>
      <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
    </form>
  );
}
