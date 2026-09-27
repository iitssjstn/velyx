import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Cloud } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { User } from '../lib/types';
import { Button } from '../components/Button';
import { useT } from '../i18n';
import { AuthShell } from './AuthShell';
import { onVidaluneApp, openWithVidalune, serversPage, shouldAutoOpen } from '../lib/vidalune';

export function LoginPage() {
  const { setUser, server } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, tRich } = useT();
  // Back from app.vidalune.com without being signed in: say why.
  const [params] = useSearchParams();
  const vidalune = params.get('vidalune');
  // On app.vidalune.com: signed in with the Vidalune account right away (the server chosen there).
  const onApp = onVidaluneApp(server?.vidalune?.appUrl);
  useEffect(() => {
    if (onApp && !vidalune && shouldAutoOpen()) openWithVidalune();
  }, [onApp, vidalune]);

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
      <p className="mt-2 text-muted">{server?.name && server.name !== 'Vidalune' ? t('auth.toServer', { name: server.name }) : t('auth.toYourServer')}</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="label" htmlFor="username">{t('auth.username')}</label>
          <input id="username" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('auth.password')}</label>
          <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {!error && (vidalune === 'unknown' || vidalune === 'failed') && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {t(vidalune === 'unknown' ? 'auth.vidaluneUnknown' : 'auth.vidaluneFailed')}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('auth.signIn')}
        </Button>
      </form>
      {server?.vidalune && (
        <a
          href={onApp ? '/_vl/open' : serversPage(server.vidalune.appUrl)}
          onClick={(e) => {
            if (!onApp) return;
            e.preventDefault();
            openWithVidalune();
          }}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-raised text-sm font-medium hover:bg-raised/80">
          <Cloud className="size-4 text-accent" aria-hidden="true" />
          {t('auth.withVidalune')}
        </a>
      )}
      <p className="mt-8 text-xs text-faint">{tRich('auth.forgotPassword', { command: <code className="text-muted">vidalune reset-password</code> })}</p>
    </AuthShell>
  );
}
