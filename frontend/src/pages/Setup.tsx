import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import type { User } from '../lib/types';
import { Button } from '../components/Button';
import { AuthShell } from './AuthShell';

export function SetupPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', password: '', confirm: '', serverName: 'Velyx' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError('The passwords do not match.');
    if (form.password.length < 8) return setError('Use at least 8 characters for the password.');
    setBusy(true);
    try {
      const res = await api.post<{ user: User }>('/api/setup', {
        username: form.username.trim(),
        password: form.password,
        serverName: form.serverName.trim() || 'Velyx',
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
      <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome to Velyx</h1>
      <p className="mt-2 text-muted">Create your administrator account to get started.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="input" autoComplete="username" required value={form.username} onChange={set('username')} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
        </div>
        <div>
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input id="confirm" type="password" className="input" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        </div>
        <div>
          <label className="label" htmlFor="serverName">Server name</label>
          <input id="serverName" className="input" value={form.serverName} onChange={set('serverName')} maxLength={64} />
        </div>
        <p className="text-xs text-faint">After setup, add your media folders in Admin → Libraries and a TMDB key for posters and descriptions in Admin → Server.</p>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create Velyx
        </Button>
      </form>
    </AuthShell>
  );
}
