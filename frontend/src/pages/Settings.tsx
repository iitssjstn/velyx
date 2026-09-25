import { useRef, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { displayName, useAuth } from '../lib/auth';
import { setPrefs, usePrefs } from '../lib/prefs';
import { detectCapabilities } from '../lib/codecs';
import { codecName } from '../lib/format';
import type { User } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';
import { ServerSettingsPanel } from './admin/ServerSettings';
import { LibrariesPanel } from './admin/Libraries';

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

const LANGUAGES = [
  ['', 'Off / file default'],
  ['en', 'English'],
  ['nl', 'Dutch'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['sv', 'Swedish'],
  ['da', 'Danish'],
  ['no', 'Norwegian'],
  ['fi', 'Finnish'],
  ['pl', 'Polish'],
  ['tr', 'Turkish'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
] as const;

function AccountSettings() {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(user?.displayName ?? '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!user) return null;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('profile');
    try {
      const res = await api.put<{ user: User }>('/api/account/profile', { displayName: name.trim() || null });
      setUser(res.user);
      toast.success('Profile saved.');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error('The new passwords do not match.');
    setBusy('password');
    try {
      await api.post('/api/account/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Password changed. Other devices were signed out.');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return toast.error('Images must be 2 MB or smaller.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read the file.'));
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
      <Section title="Profile">
        <div className="flex items-center gap-4">
          <Avatar user={user} size={64} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={busy === 'avatar'} onClick={() => fileRef.current?.click()}>
              Upload picture
            </Button>
            {user.avatarUrl && (
              <Button variant="ghost" size="sm" onClick={removeAvatar}>
                Remove
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && void uploadAvatar(e.target.files[0])} />
          </div>
        </div>
        <form onSubmit={saveProfile} className="mt-6 grid gap-4 sm:max-w-md">
          <div>
            <label className="label" htmlFor="uname">Username</label>
            <input id="uname" className="input opacity-70" value={user.username} disabled />
          </div>
          <div>
            <label className="label" htmlFor="dname">Display name</label>
            <input id="dname" className="input" value={name} maxLength={64} placeholder={user.username} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Button type="submit" loading={busy === 'profile'}>Save profile</Button>
          </div>
        </form>
      </Section>
      <Section title="Password" description="Changing your password signs you out on all other devices.">
        <form onSubmit={changePassword} className="grid gap-4 sm:max-w-md">
          <div>
            <label className="label" htmlFor="cur">Current password</label>
            <input id="cur" type="password" className="input" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="new">New password</label>
            <input id="new" type="password" className="input" autoComplete="new-password" required minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="conf">Confirm new password</label>
            <input id="conf" type="password" className="input" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <div>
            <Button type="submit" loading={busy === 'password'}>Change password</Button>
          </div>
        </form>
      </Section>
    </div>
  );
}

function PlaybackSettings() {
  const prefs = usePrefs();
  const caps = detectCapabilities();
  return (
    <div className="space-y-6">
      <Section title="Playback" description="These preferences are stored in this browser.">
        <div className="divide-y divide-line/50">
          <Toggle label="Autoplay next episode" hint="Starts the next episode after a countdown." checked={prefs.autoplayNext} onChange={(v) => setPrefs({ autoplayNext: v })} />
          <div className="flex items-center justify-between gap-6 py-3">
            <span>Countdown before the next episode</span>
            <select className="input w-28" value={prefs.autoplayCountdown} onChange={(e) => setPrefs({ autoplayCountdown: Number(e.target.value) })} disabled={!prefs.autoplayNext}>
              {[5, 10, 15, 20, 30].map((s) => (
                <option key={s} value={s}>{s} s</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-6 py-3">
            <span>Preferred subtitle language</span>
            <select className="input w-48" value={prefs.subtitleLanguage} onChange={(e) => setPrefs({ subtitleLanguage: e.target.value })}>
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-6 py-3">
            <span>Subtitle size</span>
            <select className="input w-48" value={prefs.subtitleSize} onChange={(e) => setPrefs({ subtitleSize: e.target.value as 'small' | 'medium' | 'large' })}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-6 py-3">
            <span>
              Preferred audio language
              <span className="block text-sm text-muted">Only browsers that support audio track switching (e.g. Safari) apply this.</span>
            </span>
            <select className="input w-48" value={prefs.audioLanguage} onChange={(e) => setPrefs({ audioLanguage: e.target.value })}>
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>{code === '' ? 'File default' : label}</option>
              ))}
            </select>
          </div>
          <Toggle
            label="Warn about files this browser may not play"
            checked={prefs.showCompatibilityWarnings}
            onChange={(v) => setPrefs({ showCompatibilityWarnings: v })}
          />
        </div>
      </Section>
      <Section title="This browser" description="Velyx plays files directly without converting them. These formats are supported here:">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-faint">Containers</dt>
            <dd>{caps.containers.map((c) => c.toUpperCase()).join(', ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-faint">Video</dt>
            <dd>{caps.videoCodecs.map(codecName).join(', ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-faint">Audio</dt>
            <dd>{caps.audioCodecs.map(codecName).join(', ') || '—'}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-muted">Transcoding (for formats that are not listed) will be added in a future version.</p>
      </Section>
    </div>
  );
}

function ServerInfoPanel() {
  const { server } = useAuth();
  return (
    <Section title="Server">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-faint">Name</dt>
          <dd>{server?.name}</dd>
        </div>
        <div>
          <dt className="text-faint">Version</dt>
          <dd>Velyx {server?.version}</dd>
        </div>
      </dl>
    </Section>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs = [
    { to: 'account', label: 'Account' },
    { to: 'playback', label: 'Playback' },
    { to: 'server', label: isAdmin ? 'Server & metadata' : 'Server' },
    ...(isAdmin ? [{ to: 'libraries', label: 'Libraries' }] : []),
  ];
  return (
    <div className="mx-auto max-w-4xl px-4 pt-8 sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-muted">Signed in as {displayName(user)}</p>
      <nav className="no-scrollbar mt-6 mb-8 flex gap-1 overflow-x-auto border-b border-line/60" aria-label="Settings sections">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={`/settings/${t.to}`}
            className={({ isActive }) => `-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm transition ${isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/settings/account" replace />} />
        <Route path="account" element={<AccountSettings />} />
        <Route path="playback" element={<PlaybackSettings />} />
        <Route path="server" element={isAdmin ? <ServerSettingsPanel /> : <ServerInfoPanel />} />
        {isAdmin && <Route path="libraries" element={<LibrariesPanel />} />}
        <Route path="*" element={<Navigate to="/settings/account" replace />} />
      </Routes>
    </div>
  );
}
