import { useRef, useState, type FormEvent } from 'react';
import { Check, CircleHelp, Repeat, X } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LanguagePreferences, SkipMode, SubtitleMode } from '../lib/player';
import { api, errorMessage } from '../lib/api';
import { displayName, useAuth } from '../lib/auth';
import { setPrefs, usePrefs } from '../lib/prefs';
import { subtitleLineStyle } from '../lib/subtitles';
import { detectCapabilities } from '../lib/codecs';
import type { DeviceFormat, DeviceReport, HistoryEntry, User } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';
import { SessionList } from '../components/SessionList';
import { HistoryRow } from '../components/ActiveStreams';
import { ServerSettingsPanel } from './admin/ServerSettings';
import { LibrariesPanel } from './admin/Libraries';
import { LANGUAGES, languageLabel, setLanguage, useT, type Language, type MessageKey } from '../i18n';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 py-2">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-line transition peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
        <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-ink transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

/** Audio and subtitle languages to choose from (names are shown in the interface language). */
const MEDIA_LANGUAGES = ['en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'sv', 'da', 'no', 'fi', 'pl', 'tr', 'ja', 'ko', 'zh'] as const;

/**
 * The language of Velyx itself, for this account. Separate from the audio and subtitle languages:
 * changing it never changes a track. Switches at once, without reloading. Exported for tests.
 */
export function InterfaceLanguage() {
  const { setUser } = useAuth();
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const choose = async (code: Language) => {
    if (code === lang || busy) return;
    setBusy(true);
    try {
      const res = await api.put<{ user: User }>('/api/account/language', { language: code });
      await setLanguage(code);
      setUser(res.user);
      toast.success(t('settings.language.saved'));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t('settings.language.title')} description={t('settings.language.description')}>
      <div role="radiogroup" aria-label={t('settings.language.interface')} className="flex flex-wrap gap-3">
        {LANGUAGES.map((l) => (
          <label key={l.code} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${lang === l.code ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'}`}>
            <input type="radio" name="interface-language" className="size-4 accent-[var(--color-accent)]" checked={lang === l.code} disabled={busy} onChange={() => void choose(l.code)} />
            <span lang={l.code}>{l.name}</span>
          </label>
        ))}
      </div>
    </Section>
  );
}

function AccountSettings() {
  const { user, setUser } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(user?.displayName ?? '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '', signOutOthers: true });
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!user) return null;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('profile');
    try {
      const res = await api.put<{ user: User }>('/api/account/profile', { displayName: name.trim() || null });
      setUser(res.user);
      toast.success(t('settings.account.profileSaved'));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error(t('settings.account.passwordsDoNotMatch'));
    setBusy('password');
    try {
      const res = await api.post<{ signedOut: number }>('/api/account/password', { currentPassword: pw.current, newPassword: pw.next, signOutOthers: pw.signOutOthers });
      setPw({ current: '', next: '', confirm: '', signOutOthers: true });
      toast.success(res.signedOut ? t('settings.account.passwordChangedSignedOut', { count: res.signedOut }) : t('settings.account.passwordChanged'));
      void qc.invalidateQueries({ queryKey: ['sessions', 'me'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return toast.error(t('settings.account.imageTooLarge'));
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(t('settings.account.readFailed')));
      r.readAsDataURL(file);
    });
    setBusy('avatar');
    try {
      const res = await api.put<{ user: User }>('/api/account/avatar', { dataUrl });
      setUser(res.user);
      void qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const removeAvatar = async () => {
    try {
      setUser((await api.del<{ user: User }>('/api/account/avatar')).user);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <InterfaceLanguage />
      <Section title={t('settings.account.profile')}>
        <div className="flex items-center gap-4">
          <Avatar user={user} size={64} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={busy === 'avatar'} onClick={() => fileRef.current?.click()}>
              {t('settings.account.uploadPicture')}
            </Button>
            {user.avatarUrl && (
              <Button variant="ghost" size="sm" onClick={removeAvatar}>
                {t('common.remove')}
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && void uploadAvatar(e.target.files[0])} />
          </div>
        </div>
        <form onSubmit={saveProfile} className="mt-6 grid gap-4 sm:max-w-md">
          <div>
            <label className="label" htmlFor="uname">{t('auth.username')}</label>
            <input id="uname" className="input opacity-70" value={user.username} disabled />
          </div>
          <div>
            <label className="label" htmlFor="dname">{t('settings.account.displayName')}</label>
            <input id="dname" className="input" value={name} maxLength={64} placeholder={user.username} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Button type="submit" loading={busy === 'profile'}>{t('settings.account.saveProfile')}</Button>
          </div>
        </form>
      </Section>
      <Section title={t('auth.password')}>
        <form onSubmit={changePassword} className="grid gap-4 sm:max-w-md">
          <div>
            <label className="label" htmlFor="cur">{t('settings.account.currentPassword')}</label>
            <input id="cur" type="password" className="input" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="new">{t('settings.account.newPassword')}</label>
            <input id="new" type="password" className="input" autoComplete="new-password" required minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="conf">{t('settings.account.confirmNewPassword')}</label>
            <input id="conf" type="password" className="input" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={pw.signOutOthers} onChange={(e) => setPw({ ...pw, signOutOthers: e.target.checked })} />
            {t('sessions.signOutOthers')}
          </label>
          <div>
            <Button type="submit" loading={busy === 'password'}>{t('settings.account.changePassword')}</Button>
          </div>
        </form>
      </Section>
      <Section title={t('settings.account.devices')} description={t('settings.account.devicesHint')}>
        <SessionList />
      </Section>
    </div>
  );
}

const SUBTITLE_MODES: SubtitleMode[] = ['remember', 'always', 'foreign', 'forced', 'off'];

/** Account-wide language preferences, used on every device. Exported for tests. */
export function LanguageSettings() {
  const qc = useQueryClient();
  const { t } = useT();
  const q = useQuery({ queryKey: ['account-prefs'], queryFn: () => api.get<LanguagePreferences>('/api/account/preferences') });
  const save = useMutation({
    mutationFn: (patch: Partial<LanguagePreferences>) => api.put<LanguagePreferences>('/api/account/preferences', patch),
    onSuccess: (d) => {
      qc.setQueryData(['account-prefs'], d);
      toast.success(t('settings.languages.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const p = q.data;
  const langSelect = (id: string, value: string, onChange: (v: string) => void, emptyLabel: string, disabled = false) => (
    <select id={id} className="input w-48" value={value} disabled={disabled || !p} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {MEDIA_LANGUAGES.map((code) => (
        <option key={code} value={code}>{languageLabel(code) ?? code}</option>
      ))}
      {value && !(MEDIA_LANGUAGES as readonly string[]).includes(value) && <option value={value}>{languageLabel(value) ?? value.toUpperCase()}</option>}
    </select>
  );
  const needsLanguage = p && (p.subtitleMode === 'always' || p.subtitleMode === 'foreign');
  return (
    <Section title={t('settings.languages.title')} description={t('settings.languages.description')}>
      <div className="divide-y divide-line/50">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <label htmlFor="pref-audio">
            {t('settings.languages.audio')}
            <span className="block text-sm text-muted">{t('settings.languages.audioHint')}</span>
          </label>
          {langSelect('pref-audio', p?.audioLanguage ?? '', (v) => save.mutate({ audioLanguage: v }), t('settings.languages.original'))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <label htmlFor="pref-sub-mode">
            {t('settings.languages.showSubtitles')}
            <span className="block text-sm text-muted">{t(`settings.subtitleModes.${p?.subtitleMode ?? 'remember'}.hint`)}</span>
          </label>
          <select id="pref-sub-mode" className="input w-64" value={p?.subtitleMode ?? 'remember'} disabled={!p} onChange={(e) => save.mutate({ subtitleMode: e.target.value as SubtitleMode })}>
            {SUBTITLE_MODES.map((m) => (
              <option key={m} value={m}>{t(`settings.subtitleModes.${m}.label`)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <label htmlFor="pref-sub">
            {t('settings.languages.subtitleLanguage')}
            {needsLanguage && !p?.subtitleLanguage && <span className="block text-sm text-amber">{t('settings.languages.chooseLanguage')}</span>}
          </label>
          {langSelect('pref-sub', p?.subtitleLanguage ?? '', (v) => save.mutate({ subtitleLanguage: v }), t('settings.languages.none'), p?.subtitleMode === 'off' || p?.subtitleMode === 'remember')}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <label htmlFor="pref-sub-fallback">
            {t('settings.languages.fallback')}
            <span className="block text-sm text-muted">{t('settings.languages.fallbackHint')}</span>
          </label>
          {langSelect('pref-sub-fallback', p?.subtitleFallback ?? '', (v) => save.mutate({ subtitleFallback: v }), t('settings.languages.none'), !needsLanguage)}
        </div>
      </div>
    </Section>
  );
}

const SKIP_MODES: SkipMode[] = ['ask', 'always', 'never'];

/** Skipping detected intros and credits (account-wide). Exported for tests. */
export function SkipSettings() {
  const qc = useQueryClient();
  const { t } = useT();
  const q = useQuery({ queryKey: ['account-prefs'], queryFn: () => api.get<LanguagePreferences>('/api/account/preferences') });
  const save = useMutation({
    mutationFn: (patch: Partial<LanguagePreferences>) => api.put<LanguagePreferences>('/api/account/preferences', patch),
    onSuccess: (d) => {
      qc.setQueryData(['account-prefs'], d);
      toast.success(t('settings.skip.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const p = q.data;
  const row = (id: string, label: string, hint: string, value: SkipMode, key: 'skipIntro' | 'skipCredits') => (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <label htmlFor={id}>
        {label}
        <span className="block text-sm text-muted">{hint}</span>
      </label>
      <select id={id} className="input w-56" value={value} disabled={!p} onChange={(e) => save.mutate({ [key]: e.target.value as SkipMode })}>
        {SKIP_MODES.map((m) => (
          <option key={m} value={m}>{t(`settings.skip.modes.${m}`)}</option>
        ))}
      </select>
    </div>
  );
  return (
    <Section title={t('settings.skip.title')} description={t('settings.skip.description')}>
      <div className="divide-y divide-line/50">
        {row('pref-skip-intro', t('settings.skip.intros'), t('settings.skip.introsHint'), p?.skipIntro ?? 'ask', 'skipIntro')}
        {row('pref-skip-credits', t('settings.skip.credits'), t('settings.skip.creditsHint'), p?.skipCredits ?? 'ask', 'skipCredits')}
      </div>
    </Section>
  );
}

function PlaybackSettings() {
  const prefs = usePrefs();
  const { t } = useT();
  return (
    <div className="space-y-6">
      <LanguageSettings />
      <SkipSettings />
      <Section title={t('settings.playback.title')} description={t('settings.playback.description')}>
        <div className="divide-y divide-line/50">
          <Toggle label={t('settings.playback.autoplay')} hint={t('settings.playback.autoplayHint')} checked={prefs.autoplayNext} onChange={(v) => setPrefs({ autoplayNext: v })} />
          <div className="flex items-center justify-between gap-6 py-3">
            <span>{t('settings.playback.countdown')}</span>
            <select className="input w-28" value={prefs.autoplayCountdown} onChange={(e) => setPrefs({ autoplayCountdown: Number(e.target.value) })} disabled={!prefs.autoplayNext}>
              {[5, 10, 15, 20, 30].map((s) => (
                <option key={s} value={s}>{t('time.seconds', { n: s })}</option>
              ))}
            </select>
          </div>
          <Toggle
            label={t('settings.playback.warn')}
            checked={prefs.showCompatibilityWarnings}
            onChange={(v) => setPrefs({ showCompatibilityWarnings: v })}
          />
        </div>
      </Section>
      <Section title={t('playback.audio')} description={t('settings.audio.description')}>
        <div className="divide-y divide-line/50">
          <div className="flex items-center justify-between gap-6 py-3">
            <span>
              {t('settings.audio.sound')}
              <span className="block text-sm text-muted">{t('settings.audio.soundHint')}</span>
            </span>
            <select className="input w-48" value={prefs.audioOutput} onChange={(e) => setPrefs({ audioOutput: e.target.value as 'stereo' | 'surround' })}>
              <option value="stereo">{t('media.stereo')}</option>
              <option value="surround">{t('settings.audio.surround')}</option>
            </select>
          </div>
          <Toggle label={t('settings.audio.boostVoices')} hint={t('settings.audio.boostVoicesHint')} checked={prefs.boostVoices} onChange={(v) => setPrefs({ boostVoices: v })} />
          <Toggle label={t('settings.audio.levelVolume')} hint={t('settings.audio.levelVolumeHint')} checked={prefs.levelVolume} onChange={(v) => setPrefs({ levelVolume: v })} />
        </div>
      </Section>
      <Section title={t('settings.subtitles.title')} description={t('settings.subtitles.description')}>
        <SubtitlePreview />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <PrefSelect label={t('subtitleStyle.size')} value={prefs.subtitleSize} onChange={(v) => setPrefs({ subtitleSize: v })} options={[['small', t('subtitleStyle.small')], ['medium', t('subtitleStyle.medium')], ['large', t('subtitleStyle.large')], ['xlarge', t('subtitleStyle.xlarge')]]} />
          <PrefSelect label={t('subtitleStyle.color')} value={prefs.subtitleColor} onChange={(v) => setPrefs({ subtitleColor: v })} options={[['white', t('subtitleStyle.white')], ['yellow', t('subtitleStyle.yellow')]]} />
          <PrefSelect label={t('subtitleStyle.background')} value={prefs.subtitleBackground} onChange={(v) => setPrefs({ subtitleBackground: v })} options={[['none', t('subtitleStyle.none')], ['translucent', t('subtitleStyle.dimmed')], ['solid', t('subtitleStyle.solid')]]} />
          <PrefSelect label={t('subtitleStyle.edge')} value={prefs.subtitleEdge} onChange={(v) => setPrefs({ subtitleEdge: v })} options={[['shadow', t('subtitleStyle.shadow')], ['outline', t('subtitleStyle.outline')], ['none', t('subtitleStyle.none')]]} />
          <PrefSelect
            label={t('subtitleStyle.position')}
            value={String(prefs.subtitlePosition)}
            onChange={(v) => setPrefs({ subtitlePosition: Number(v) })}
            options={[['0', t('subtitleStyle.bottom')], ['5', t('subtitleStyle.slightlyHigher')], ['10', t('subtitleStyle.higher')], ['15', t('subtitleStyle.muchHigher')], ['20', t('subtitleStyle.highest')]]}
          />
        </div>
      </Section>
      <CurrentDevice />
    </div>
  );
}

const SUPPORT: Record<DeviceFormat['support'], { icon: typeof Check; label: MessageKey; className: string }> = {
  yes: { icon: Check, label: 'settings.device.plays', className: 'text-ok' },
  converted: { icon: Repeat, label: 'settings.device.converted', className: 'text-accent' },
  depends: { icon: CircleHelp, label: 'settings.device.depends', className: 'text-muted' },
  no: { icon: X, label: 'playback.notSupported', className: 'text-danger' },
};

const KINDS: Array<{ kind: DeviceFormat['kind']; title: MessageKey }> = [
  { kind: 'video', title: 'playback.video' },
  { kind: 'audio', title: 'playback.audio' },
  { kind: 'container', title: 'settings.device.containers' },
  { kind: 'display', title: 'settings.device.screen' },
];

/** What this device plays, from the formats the browser reports, named like "Chrome on Windows". */
export function CurrentDevice() {
  const { t, lang } = useT();
  const q = useQuery({
    queryKey: ['playback-device', lang],
    queryFn: () => api.post<DeviceReport>('/api/playback/device', detectCapabilities()),
    staleTime: Infinity,
  });
  return (
    <Section title={t('settings.device.title')} description={t('settings.device.description')}>
      {q.isLoading ? (
        <p className="text-sm text-muted">{t('settings.device.checking')}</p>
      ) : q.error || !q.data ? (
        <p className="text-sm text-danger">{errorMessage(q.error)}</p>
      ) : (
        <>
          <p className="font-display text-base font-semibold">{q.data.device}</p>
          {q.data.confidence !== 'reported' && <p className="mt-1 text-sm text-amber">{t('settings.device.estimates')}</p>}
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            {KINDS.map(({ kind, title }) => (
              <div key={kind}>
                <h3 className="text-xs font-medium tracking-wide text-faint uppercase">{t(title)}</h3>
                <ul className="mt-2 space-y-2">
                  {q.data.formats
                    .filter((f) => f.kind === kind)
                    .map((f) => {
                      const s = SUPPORT[f.support];
                      const Icon = s.icon;
                      return (
                        <li key={f.key} className="flex items-start gap-3 text-sm">
                          <Icon className={`mt-0.5 size-4 shrink-0 ${s.className}`} strokeWidth={2.5} role="img" aria-label={t(s.label)} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <span>{f.label}</span>
                              <span className={`text-xs ${s.className}`}>{t(s.label)}</span>
                            </span>
                            {f.note && <span className="block text-xs text-muted">{f.note}</span>}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

function ServerInfoPanel() {
  const { server } = useAuth();
  const { t } = useT();
  return (
    <Section title={t('settings.server.title')}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-faint">{t('common.name')}</dt>
          <dd>{server?.name}</dd>
        </div>
        <div>
          <dt className="text-faint">{t('settings.server.version')}</dt>
          <dd>Velyx {server?.version}</dd>
        </div>
      </dl>
    </Section>
  );
}

const HISTORY_PAGE = 30;

/** What you watched, when, for how long and how it played. Only your own viewings. Exported for tests. */
export function WatchHistory() {
  const { t } = useT();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['account-history', page],
    queryFn: () => api.get<{ total: number; items: HistoryEntry[] }>(`/api/account/history?page=${page}&limit=${HISTORY_PAGE}`),
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / HISTORY_PAGE));
  return (
    <Section title={t('settings.history.title')} description={t('settings.history.description')}>
      {q.isLoading ? (
        <p className="text-sm text-muted">{t('common.loadingDots')}</p>
      ) : q.error || !q.data ? (
        <p className="text-sm text-danger">{errorMessage(q.error)}</p>
      ) : q.data.items.length === 0 ? (
        <p className="text-sm text-muted">{t('settings.history.empty')}</p>
      ) : (
        <ul className="-mx-4 divide-y divide-line/50">
          {q.data.items.map((h) => (
            <HistoryRow key={h.id} h={h} showUser={false} />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <span className="mr-2 text-muted">{t('common.pageOf', { page, pages })}</span>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
        </div>
      )}
    </Section>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const { t } = useT();
  const isAdmin = user?.role === 'admin';
  const tabs = [
    { to: 'account', label: t('settings.tabs.account') },
    { to: 'playback', label: t('settings.tabs.playback') },
    { to: 'history', label: t('settings.tabs.history') },
    { to: 'server', label: isAdmin ? t('settings.tabs.serverMetadata') : t('settings.tabs.server') },
    ...(isAdmin ? [{ to: 'libraries', label: t('settings.tabs.libraries') }] : []),
  ];
  return (
    <div className="mx-auto max-w-4xl px-4 pt-8 sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('nav.settings')}</h1>
      <p className="mt-1 text-muted">{t('settings.signedInAs', { name: displayName(user) })}</p>
      <nav className="no-scrollbar mt-6 mb-8 flex gap-1 overflow-x-auto border-b border-line/60 sm:flex-wrap sm:overflow-visible" aria-label={t('settings.sections')}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/settings/${tab.to}`}
            className={({ isActive }) => `-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm transition ${isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/settings/account" replace />} />
        <Route path="account" element={<AccountSettings />} />
        <Route path="playback" element={<PlaybackSettings />} />
        <Route path="history" element={<WatchHistory />} />
        <Route path="server" element={isAdmin ? <ServerSettingsPanel /> : <ServerInfoPanel />} />
        {isAdmin && <Route path="libraries" element={<LibrariesPanel />} />}
        <Route path="*" element={<Navigate to="/settings/account" replace />} />
      </Routes>
    </div>
  );
}

function PrefSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  );
}

/** Live preview of the subtitle style on a dark "video" background. */
function SubtitlePreview() {
  const prefs = usePrefs();
  const { t } = useT();
  const style = subtitleLineStyle(prefs);
  return (
    <div className="relative h-40 overflow-hidden rounded-lg bg-[linear-gradient(135deg,#3a3450,#1a1622_60%,#0c0a10)]" aria-label={t('subtitleStyle.preview')}>
      <div className="absolute inset-x-0 flex justify-center px-4 text-center" style={{ bottom: `calc(8% + ${prefs.subtitlePosition}%)`, fontSize: style.fontSize }}>
        <span style={style}>
          {t('subtitleStyle.sample')}
          <br />
          <i>{t('subtitleStyle.sampleItalic')}</i>
        </span>
      </div>
    </div>
  );
}
