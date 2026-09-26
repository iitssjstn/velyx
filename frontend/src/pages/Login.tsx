import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { User } from '../lib/types';
import { Button } from '../components/Button';
import { useT } from '../i18n';
import { AuthShell } from './AuthShell';

export function LoginPage() {
  const { setUser, server } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, tRich } = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ user: User }>('/api/auth/login', { username: username.trim(), password });
      setUser(res.user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('auth.signIn')}</h1>
      <p className="mt-2 text-muted">{server?.name && server.name !== 'Velyx' ? t('auth.toServer', { name: server.name }) : t('auth.toYourServer')}</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="label" htmlFor="username">{t('auth.username')}</label>
          <input id="username" className="input" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('auth.password')}</label>
          <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('auth.signIn')}
        </Button>
      </form>
      <p className="mt-8 text-xs text-faint">{tRich('auth.forgotPassword', { command: <code className="text-muted">velyx reset-password</code> })}</p>
    </AuthShell>
  );
}
