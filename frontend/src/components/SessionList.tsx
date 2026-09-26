import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Monitor, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { deviceName, formatRelative } from '../lib/format';
import type { SessionInfo } from '../lib/types';
import { Button } from './Button';
import { Spinner } from './States';
import { toast } from './Toast';
import { useT } from '../i18n';

/**
 * Active sign-ins with a way to end them. `userId` shows another user's sessions (admin);
 * without it, the signed-in user's own sessions are shown.
 */
export function SessionList({ userId }: { userId?: number }) {
  const qc = useQueryClient();
  const { t } = useT();
  const base = userId ? `/api/users/${userId}/sessions` : '/api/account/sessions';
  const key = ['sessions', userId ?? 'me'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<SessionInfo[]>(base) });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`${base}/${id}`),
    onSuccess: () => {
      toast.success(t('sessions.ended'));
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(err),
  });
  const revokeAll = useMutation({
    mutationFn: () => (userId ? api.del<{ revoked: number }>(base) : api.post<{ revoked: number }>('/api/account/sessions/revoke-others')),
    onSuccess: (r) => {
      toast.success(t('sessions.endedCount', { count: r.revoked }));
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <Spinner className="mx-auto size-6" />;
  if (q.error || !q.data) return <p className="text-sm text-danger">{t('sessions.loadFailed')}</p>;
  const others = q.data.filter((s) => !s.current);
  return (
    <div>
      {q.data.length === 0 ? (
        <p className="text-sm text-muted">{t('sessions.none')}</p>
      ) : (
        <ul className="divide-y divide-line/60 rounded-xl border border-line">
          {q.data.map((s) => {
            const Icon = /Android|iOS/.test(s.device) ? Smartphone : Monitor;
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Icon className="size-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {deviceName(s.device)}
                    {s.current && <span className="ml-2 rounded-full bg-ok/15 px-2 py-0.5 text-xs text-ok">{t('sessions.thisDevice')}</span>}
                  </p>
                  <p className="truncate text-xs text-faint" title={s.userAgent ?? undefined}>
                    {t('sessions.activeSignedIn', { active: formatRelative(s.lastSeenAt), signedIn: formatRelative(s.createdAt) })}
                    {s.ip && ` · ${s.ip}`}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                    {t('sessions.revoke')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button variant="danger" size="sm" icon={<LogOut className="size-4" />} loading={revokeAll.isPending} onClick={() => revokeAll.mutate()}>
            {userId ? t('sessions.revokeAll') : t('sessions.signOutOthers')}
          </Button>
        </div>
      )}
    </div>
  );
}
