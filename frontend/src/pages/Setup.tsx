import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import type { User } from '../lib/types';
import { Button } from '../components/Button';
import { currentLanguage, useT } from '../i18n';
import { AuthShell } from './AuthShell';

export function SetupPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', password: '', confirm: '', serverName: 'Velyx', tmdbApiKey: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useT();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError(t('auth.passwordsDoNotMatch'));
    if (form.password.length < 8) return setError(t('auth.passwordTooShort'));
    setBusy(true);
    try {
      const res = await api.post<{ user: User }>('/api/setup', {
        username: form.username.trim(),
        password: form.password,
        serverName: form.serverName.trim() || 'Velyx',
        tmdbApiKey: form.tmdbApiKey.trim() || undefined,
        // The language chosen on this page becomes the administrator's interface language.
        language: currentLanguage(),
      });
      qc.setQueryData(['me'], res.user);
      // Once server-info reports setup as done, the router sends the new admin to the libraries page.
      await qc.invalidateQueries({ queryKey: ['server-info'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('setup.welcome')}</h1>
      <p className="mt-2 text-muted">{t('setup.intro')}</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="label" htmlFor="username">{t('auth.username')}</label>
          <input id="username" className="input" autoComplete="username" required value={form.username} onChange={set('username')} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('auth.password')}</label>
          <input id="password" type="password" className="input" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
        </div>
        <div>
          <label className="label" htmlFor="confirm">{t('auth.confirmPassword')}</label>
          <input id="confirm" type="password" className="input" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        </div>
        <div>
          <label className="label" htmlFor="serverName">{t('setup.serverName')}</label>
          <input id="serverName" className="input" value={form.serverName} onChange={set('serverName')} maxLength={64} />
        </div>
        <div>
          <label className="label" htmlFor="tmdbApiKey">{t('setup.tmdbKey')} <span className="font-normal text-faint">{t('common.optional')}</span></label>
          <input id="tmdbApiKey" className="input" autoComplete="off" spellCheck={false} value={form.tmdbApiKey} onChange={set('tmdbApiKey')} maxLength={512} placeholder={t('setup.tmdbKeyPlaceholder')} />
        </div>
        <p className="text-xs text-faint">{t('setup.afterSetup')}</p>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('setup.create')}
        </Button>
      </form>
    </AuthShell>
  );
}
