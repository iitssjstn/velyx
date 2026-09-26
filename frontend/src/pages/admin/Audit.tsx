import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api, qs } from '../../lib/api';
import type { AuditEntry, Paged } from '../../lib/types';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';
import { intlLocale, t, useT, type MessageKey } from '../../i18n';

/** Readable names for audit actions (the action codes the server records). */
const AUDIT_ACTIONS: Record<string, MessageKey> = {
  'login.success': 'audit.actions.loginSuccess',
  'login.failed': 'audit.actions.loginFailed',
  'login.blocked': 'audit.actions.loginBlocked',
  'logout': 'audit.actions.logout',
  'setup.completed': 'audit.actions.setupCompleted',
  'user.created': 'audit.actions.userCreated',
  'user.updated': 'audit.actions.userUpdated',
  'user.deleted': 'audit.actions.userDeleted',
  'user.password_reset': 'audit.actions.userPasswordReset',
  'account.password_changed': 'audit.actions.accountPasswordChanged',
  'session.revoked': 'audit.actions.sessionRevoked',
  'session.revoked_all': 'audit.actions.sessionRevokedAll',
  'library.created': 'audit.actions.libraryCreated',
  'library.updated': 'audit.actions.libraryUpdated',
  'library.deleted': 'audit.actions.libraryDeleted',
  'library.scan': 'audit.actions.libraryScan',
  'scans.paused': 'audit.actions.scansPaused',
  'scans.resumed': 'audit.actions.scansResumed',
  'metadata.matched': 'audit.actions.metadataMatched',
  'metadata.refreshed': 'audit.actions.metadataRefreshed',
  'settings.updated': 'audit.actions.settingsUpdated',
  'tmdb.updated': 'audit.actions.tmdbUpdated',
  'backup.created': 'audit.actions.backupCreated',
  'backup.downloaded': 'audit.actions.backupDownloaded',
  'backup.deleted': 'audit.actions.backupDeleted',
  'database.restored': 'audit.actions.databaseRestored',
  'cache.cleared': 'audit.actions.cacheCleared',
  'collection.created': 'audit.actions.collectionCreated',
  'collection.deleted': 'audit.actions.collectionDeleted',
  'cleanup.deleted': 'audit.actions.cleanupDeleted',
  'cleanup.kept': 'audit.actions.cleanupKept',
  'cleanup.settings': 'audit.actions.cleanupSettings',
  'segments.analyze': 'audit.actions.segmentsAnalyze',
  'segments.edited': 'audit.actions.segmentsEdited',
  'segments.reset': 'audit.actions.segmentsReset',
};

export function auditLabel(action: string): string {
  return AUDIT_ACTIONS[action] ? t(AUDIT_ACTIONS[action]) : action;
}

/** Details the server records as fixed phrases. */
const DETAILS: Record<string, MessageKey> = {
  'wrong password': 'audit.details.wrongPassword',
  'unknown user': 'audit.details.unknownUser',
  'account disabled': 'audit.details.accountDisabled',
  'other sessions kept': 'audit.details.otherSessionsKept',
};

const GROUPS: Array<{ value: string; label: MessageKey }> = [
  { value: '', label: 'audit.groups.all' },
  { value: 'login.', label: 'audit.groups.signIns' },
  { value: 'user.', label: 'audit.groups.users' },
  { value: 'session.', label: 'audit.groups.sessions' },
  { value: 'library.', label: 'audit.groups.libraries' },
  { value: 'cleanup.', label: 'audit.groups.cleanup' },
  { value: 'settings.updated', label: 'audit.groups.serverSettings' },
  { value: 'tmdb.updated', label: 'audit.groups.tmdb' },
  { value: 'backup.', label: 'audit.groups.backups' },
];

const PAGE = 50;

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { t } = useT();
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
        <p className="text-sm text-muted">{t('audit.intro')}</p>
        <select
          aria-label={t('audit.eventType')}
          className="input h-10 w-auto py-0 pr-8 text-sm"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>{t(g.label)}</option>
          ))}
        </select>
      </div>
      {q.data.items.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-6" />} title={t('audit.empty')} />
      ) : (
        <ol className="panel divide-y divide-line/60">
          {q.data.items.map((e) => (
            <li key={e.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <time className="text-xs text-faint tabular-nums sm:pt-0.5" dateTime={new Date(e.at).toISOString()}>
                {new Date(e.at).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
              <div className="min-w-0 text-sm">
                <p>
                  <span className={e.action === 'login.failed' || e.action === 'login.blocked' ? 'text-amber' : 'font-medium'}>{e.actorName ?? t('audit.someone')}</span>
                  <span className="text-faint"> · </span>
                  <span className="text-ink/80">{auditLabel(e.action)}</span>
                  {e.target && <span className="font-medium"> “{e.target}”</span>}
                </p>
                {(e.detail || e.ip) && (
                  <p className="truncate text-xs text-faint">
                    {e.detail && (DETAILS[e.detail] ? t(DETAILS[e.detail]) : e.detail)}
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
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('audit.newer')}</Button>
          <span className="text-muted">{t('common.pageOf', { page, pages })}</span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('audit.older')}</Button>
        </div>
      )}
    </div>
  );
}
