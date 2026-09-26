import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone, Pencil, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import { displayName, useAuth } from '../../lib/auth';
import { formatRelative } from '../../lib/format';
import type { AdminUser, Library } from '../../lib/types';
import { Avatar } from '../../components/Avatar';
import { Button, IconButton } from '../../components/Button';
import { ConfirmModal, Modal } from '../../components/Modal';
import { ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';
import { SessionList } from '../../components/SessionList';
import { useT } from '../../i18n';

function UserForm({ user, isSelf, onDone }: { user?: AdminUser; isSelf: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const { t } = useT();
  const [form, setForm] = useState({
    username: user?.username ?? '',
    displayName: user?.displayName ?? '',
    role: user?.role ?? ('user' as 'admin' | 'user'),
    disabled: user?.disabled ?? false,
    password: '',
    /** null = every library, including ones added later. */
    libraryIds: user?.libraryIds ?? null,
  });
  const libs = useQuery({ queryKey: ['libraries'], queryFn: () => api.get<{ libraries: Library[] }>('/api/libraries') });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      if (!user)
        return api.post('/api/users', {
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim() || undefined,
          role: form.role,
          libraryIds: form.libraryIds,
        });
      const body: Record<string, unknown> = { displayName: form.displayName.trim() || null, libraryIds: form.libraryIds };
      if (!isSelf) {
        body.role = form.role;
        body.disabled = form.disabled;
      }
      if (form.password) body.password = form.password;
      return api.put(`/api/users/${user.id}`, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(user ? t('users.updated') : t('users.created'));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    m.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="u-name">{t('auth.username')}</label>
        <input id="u-name" className="input" required disabled={Boolean(user)} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="u-display">{t('settings.account.displayName')}</label>
        <input id="u-display" className="input" maxLength={64} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="u-pass">{user ? t('users.resetPassword') : t('auth.password')}</label>
        <input
          id="u-pass"
          type="password"
          className="input"
          required={!user}
          minLength={8}
          autoComplete="new-password"
          placeholder={user ? t('users.keepPassword') : t('users.atLeast8')}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {user && form.password && <p className="mt-1 text-xs text-faint">{t('users.signedOutEverywhere')}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="u-role">{t('users.role')}</label>
          <select id="u-role" className="input" value={form.role} disabled={isSelf} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}>
            <option value="user">{t('users.roleUser')}</option>
            <option value="admin">{t('users.roleAdmin')}</option>
          </select>
        </div>
        {user && (
          <label className="flex items-center gap-3 self-end pb-3 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={form.disabled} disabled={isSelf} onChange={(e) => setForm({ ...form, disabled: e.target.checked })} />
            {t('users.accountDisabled')}
          </label>
        )}
      </div>
      {isSelf && <p className="text-xs text-faint">{t('users.cannotChangeSelf')}</p>}
      <fieldset>
        <legend className="label">{t('users.libraryAccess')}</legend>
        {form.role === 'admin' ? (
          <p className="text-sm text-muted">{t('users.adminsSeeAll')}</p>
        ) : (
          <div className="space-y-2">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={form.libraryIds === null}
                onChange={(e) => setForm({ ...form, libraryIds: e.target.checked ? null : (libs.data?.libraries.map((l) => l.id) ?? []) })}
              />
              {t('users.allLibraries')}
            </label>
            {form.libraryIds !== null && (
              <div className="ml-7 space-y-2">
                {libs.data?.libraries.map((l) => (
                  <label key={l.id} className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-accent)]"
                      checked={form.libraryIds!.includes(l.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          libraryIds: e.target.checked ? [...form.libraryIds!, l.id] : form.libraryIds!.filter((id) => id !== l.id),
                        })
                      }
                    />
                    {l.name}
                    <span className="text-faint">{l.type === 'movies' ? t('nav.movies') : t('nav.tvShows')}</span>
                  </label>
                ))}
                {libs.data && !libs.data.libraries.length && <p className="text-sm text-faint">{t('home.noLibraries')}.</p>}
                {form.libraryIds!.length === 0 && <p className="text-xs text-faint">{t('users.noLibrariesSelected')}</p>}
              </div>
            )}
          </div>
        )}
      </fieldset>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" loading={m.isPending}>{user ? t('common.save') : t('users.create')}</Button>
      </div>
    </form>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [sessionsOf, setSessionsOf] = useState<AdminUser | null>(null);
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<AdminUser[]>('/api/users') });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/users/${id}`),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('users.deleted'));
    },
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('users.intro')}</p>
        <Button icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>{t('users.add')}</Button>
      </div>
      <ul className="panel divide-y divide-line/60">
        {q.data.map((u) => (
          <li key={u.id} className="flex items-center gap-4 p-4">
            <Avatar user={u} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {displayName(u)}
                {u.id === me?.id && <span className="ml-2 text-xs text-faint">{t('users.you')}</span>}
              </p>
              <p className="truncate text-sm text-muted">
                @{u.username}
                <span className="ml-3 text-faint">{t('users.lastSignIn', { when: formatRelative(u.lastLoginAt) })}</span>
              </p>
            </div>
            {u.role !== 'admin' && u.libraryIds && (
              <span className="hidden rounded-full bg-raised px-2.5 py-0.5 text-xs text-muted sm:inline" title={t('users.someLibraries')}>
                {t('users.libraryCount', { count: u.libraryIds.length })}
              </span>
            )}
            <span className={`hidden rounded-full px-2.5 py-0.5 text-xs sm:inline ${u.role === 'admin' ? 'bg-accent/15 text-accent' : 'bg-raised text-muted'}`}>{u.role === 'admin' ? t('roles.admin') : t('roles.user')}</span>
            {u.disabled && <span className="rounded-full bg-danger/15 px-2.5 py-0.5 text-xs text-danger">{t('users.disabled')}</span>}
            <div className="flex">
              <IconButton label={t('users.sessionsOf', { name: displayName(u) })} onClick={() => setSessionsOf(u)}>
                <MonitorSmartphone className="size-4" />
              </IconButton>
              <IconButton label={t('users.edit')} onClick={() => setEditing(u)}>
                <Pencil className="size-4" />
              </IconButton>
              {u.id !== me?.id && (
                <IconButton label={t('users.delete')} onClick={() => setDeleting(u)} className="hover:!text-danger">
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Modal title={t('users.add')} open={creating} onClose={() => setCreating(false)}>
        {creating && <UserForm isSelf={false} onDone={() => setCreating(false)} />}
      </Modal>
      <Modal title={t('users.edit')} open={Boolean(editing)} onClose={() => setEditing(null)}>
        {editing && <UserForm user={editing} isSelf={editing.id === me?.id} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal title={sessionsOf ? t('users.sessionsTitle', { name: displayName(sessionsOf) }) : t('users.sessions')} open={Boolean(sessionsOf)} onClose={() => setSessionsOf(null)}>
        {sessionsOf && <SessionList userId={sessionsOf.id} />}
      </Modal>
      <ConfirmModal
        open={Boolean(deleting)}
        title={t('users.deleteTitle')}
        confirmLabel={t('users.delete')}
        danger
        loading={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      >
        {deleting && t('users.deleteText', { name: displayName(deleting) })}
      </ConfirmModal>
    </div>
  );
}
