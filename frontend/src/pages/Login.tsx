import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { User } from '../lib/types';
import { Button } from '../components/Button';
import { AuthShell } from './AuthShell';

export function LoginPage() {
  const { setUser, server } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-muted">to {server?.name && server.name !== 'Velyx' ? server.name : 'your Velyx server'}</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="input" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-xs text-faint">Forgot your password? An administrator can reset it, or run <code className="text-muted">velyx reset-password</code> on the server.</p>
    </AuthShell>
  );
}
