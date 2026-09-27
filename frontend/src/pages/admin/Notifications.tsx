import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

export const NOTIFICATION_EVENTS = ['cleanupPlanned', 'cleanupDeleted', 'newMedia', 'scanFailed', 'backupFailed', 'newDevice', 'storageLow'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export interface NotificationItem {
  id: number;
  event: NotificationEvent;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
}

interface NotificationSettings {
  events: Record<NotificationEvent, boolean>;
  discord: { configured: boolean; hint: string | null };
}

/** Unread notifications, for the badge on the admin tab. */
export function useUnreadNotifications(): number {
  const q = useQuery({ queryKey: ['admin', 'notifications', 'unread'], queryFn: () => api.get<{ unread: number }>('/api/admin/notifications/unread'), refetchInterval: 60_000 });
  return q.data?.unread ?? 0;
}

function Settings() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'notifications', 'settings'], queryFn: () => api.get<NotificationSettings>('/api/admin/notifications/settings') });
  const [webhook, setWebhook] = useState('');
  const save = useMutation({
    mutationFn: (body: { events?: Partial<Record<NotificationEvent, boolean>>; discordWebhook?: string }) => api.put<NotificationSettings>('/api/admin/notifications/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'notifications', 'settings'], data);
      setWebhook('');
      toast.success(t('notifications.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error: string | null }>('/api/admin/notifications/test'),
    onSuccess: (r) => (r.ok ? toast.success(t('notifications.discordTestOk')) : toast.error(t('notifications.discordTestFailed', { error: r.error ?? '' }))),
    onError: (err) => toast.error(err),
  });
  if (!q.data) return null;
  const s = q.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-2 p-4" aria-labelledby="notify-events">
        <h2 id="notify-events" className="font-display text-lg font-semibold">{t('notifications.settingsTitle')}</h2>
        {NOTIFICATION_EVENTS.map((e) => (
          <label key={e} className="flex items-center gap-3 py-1 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={s.events[e]} disabled={save.isPending} onChange={(ev) => save.mutate({ events: { [e]: ev.target.checked } })} />
            {t(`notifications.events.${e}`)}
          </label>
        ))}
      </section>
      <section className="panel space-y-3 p-4" aria-labelledby="notify-discord">
        <h2 id="notify-discord" className="font-display text-lg font-semibold">{t('notifications.discordTitle')}</h2>
        <p className="text-sm text-muted">{t('notifications.discordIntro')}</p>
        <p className="text-sm">{s.discord.configured ? t('notifications.discordConfigured', { hint: s.discord.hint ?? '' }) : t('notifications.discordNotSet')}</p>
        <label className="block text-sm">
          <span className="text-muted">{t('notifications.discordAddress')}</span>
          <input className="input mt-1 w-full" type="url" autoComplete="off" placeholder="https://discord.com/api/webhooks/…" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!webhook.trim()} loading={save.isPending} onClick={() => save.mutate({ discordWebhook: webhook.trim() })}>{t('notifications.discordSave')}</Button>
          {s.discord.configured && (
            <>
              <Button variant="secondary" size="sm" icon={<Send className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>{t('notifications.discordTest')}</Button>
              <Button variant="ghost" size="sm" onClick={() => save.mutate({ discordWebhook: '' })}>{t('notifications.discordRemove')}</Button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** Admin → Notifications: what Velyx did on its own, and where administrators are told about it. */
export function NotificationsPage() {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'notifications', 'list', lang], queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/api/admin/notifications') });
  const read = useMutation({
    mutationFn: () => api.post('/api/admin/notifications/read'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'notifications'] }),
    onError: (err) => toast.error(err),
  });
  if (q.isLoading) return <PageLoader />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { items, unread } = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">{t('notifications.intro')}</p>
        {unread > 0 && (
          <Button variant="secondary" size="sm" icon={<CheckCheck className="size-4" />} loading={read.isPending} onClick={() => read.mutate()}>
            {t('notifications.markRead')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-6" />} title={t('notifications.empty')} />
      ) : (
        <ul className="panel divide-y divide-line/50">
          {items.map((n) => (
            <li key={n.id} className={`px-4 py-3 ${n.read ? '' : 'bg-accent/5'}`}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <p className={n.read ? 'text-ink/85' : 'font-semibold'}>{n.title}</p>
                <span className="ml-auto text-xs text-faint">{formatRelative(n.createdAt)}</span>
              </div>
              {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
            </li>
          ))}
        </ul>
      )}
      <Settings />
    </div>
  );
}
