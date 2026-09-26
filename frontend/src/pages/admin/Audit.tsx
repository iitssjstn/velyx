import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api, qs } from '../../lib/api';
import type { AuditEntry, Paged } from '../../lib/types';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';

/** Readable names for audit actions. */
export const AUDIT_LABELS: Record<string, string> = {
  'login.success': 'Signed in',
  'login.failed': 'Failed sign-in',
  'login.blocked': 'Sign-in throttled',
  logout: 'Signed out',
  'setup.completed': 'Completed setup',
  'user.created': 'Created user',
  'user.updated': 'Changed user',
  'user.deleted': 'Deleted user',
  'user.password_reset': 'Reset password of',
  'account.password_changed': 'Changed own password',
  'session.revoked': 'Revoked a session of',
  'session.revoked_all': 'Revoked all sessions of',
  'library.created': 'Created library',
  'library.updated': 'Changed library',
  'library.deleted': 'Deleted library',
  'library.scan': 'Started a scan of',
  'scans.paused': 'Paused scanning',
  'scans.resumed': 'Resumed scanning',
  'metadata.matched': 'Changed the match of',
  'metadata.refreshed': 'Refreshed metadata of',
  'settings.updated': 'Changed server settings',
  'tmdb.updated': 'Changed TMDB settings',
  'backup.created': 'Created a backup',
  'backup.downloaded': 'Downloaded a backup',
  'backup.deleted': 'Deleted backup',
  'database.restored': 'Restored the database',
  'cache.cleared': 'Cleared cache',
  'collection.created': 'Created collection',
  'collection.deleted': 'Deleted collection',
};

const GROUPS = [
  { value: '', label: 'All events' },
  { value: 'login.', label: 'Sign-ins' },
  { value: 'user.', label: 'Users' },
  { value: 'session.', label: 'Sessions' },
  { value: 'library.', label: 'Libraries' },
  { value: 'settings.updated', label: 'Server settings' },
  { value: 'tmdb.updated', label: 'TMDB' },
  { value: 'backup.', label: 'Backups' },
];

const PAGE = 50;

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = useQuery({
    queryKey: ['audit', page, action],
    queryFn: () => api.get<Paged<AuditEntry>>(`/api/admin/audit${qs({ page, limit: PAGE, action: action || undefined })}`),
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const pages = Math.max(1, Math.ceil(q.data.total / PAGE));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Sign-ins and administrative changes. Passwords, API keys and session tokens are never recorded.</p>
        <select
          aria-label="Event type"
          className="input h-10 w-auto py-0 pr-8 text-sm"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </div>
      {q.data.items.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-6" />} title="Nothing recorded yet" />
      ) : (
        <ol className="panel divide-y divide-line/60">
          {q.data.items.map((e) => (
            <li key={e.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <time className="text-xs text-faint tabular-nums sm:pt-0.5" dateTime={new Date(e.at).toISOString()}>
                {new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
              <div className="min-w-0 text-sm">
                <p>
                  <span className={e.action === 'login.failed' || e.action === 'login.blocked' ? 'text-amber' : 'font-medium'}>{e.actorName ?? 'Someone'}</span>{' '}
                  <span className="text-ink/80">{(AUDIT_LABELS[e.action] ?? e.action).toLowerCase()}</span>
                  {e.target && <span className="font-medium"> “{e.target}”</span>}
                </p>
                {(e.detail || e.ip) && (
                  <p className="truncate text-xs text-faint">
                    {e.detail}
                    {e.detail && e.ip && ' · '}
                    {e.ip}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
          <span className="text-muted">Page {page} of {pages}</span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}
