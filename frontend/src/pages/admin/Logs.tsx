import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import type { LogEntry } from '../../lib/types';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';
import { intlLocale, useT } from '../../i18n';

const LEVEL_STYLE: Record<LogEntry['level'], string> = {
  debug: 'text-faint',
  info: 'text-muted',
  warn: 'text-amber',
  error: 'text-danger',
};

export function LogsPage() {
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const [filter, setFilter] = useState('');
  const [live, setLive] = useState(true);
  const { t, tRich } = useT();
  const q = useQuery({ queryKey: ['admin', 'logs'], queryFn: () => api.get<LogEntry[]>('/api/admin/logs'), refetchInterval: live ? 5000 : false });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const f = filter.trim().toLowerCase();
  const rows = q.data.filter(
    (l) => (level === 'all' || (level === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error')) && (!f || l.message.toLowerCase().includes(f) || l.module.includes(f)),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input h-9 w-auto py-0 text-sm" value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label={t('logs.level')}>
          <option value="all">{t('logs.allLevels')}</option>
          <option value="warn">{t('logs.warnings')}</option>
          <option value="error">{t('logs.errors')}</option>
        </select>
        <input className="input h-9 max-w-xs py-0 text-sm" placeholder={t('logs.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('logs.filterLogs')} />
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={live} onChange={(e) => setLive(e.target.checked)} /> {t('logs.autoRefresh')}
        </label>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => q.refetch()}>{t('common.refresh')}</Button>
      </div>
      <p className="text-xs text-faint">{tRich('logs.recent', { command: <code>docker compose logs velyx</code> })}</p>
      <div className="panel max-h-[65vh] overflow-auto p-2 font-mono text-xs">
        {rows.length === 0 ? (
          <p className="p-4 text-muted">{t('logs.none')}</p>
        ) : (
          rows.map((l, i) => (
            <div key={i} className="grid grid-cols-[auto_auto_1fr] gap-3 rounded px-2 py-1 hover:bg-raised">
              <span className="text-faint tabular-nums">{new Date(l.time).toLocaleTimeString(intlLocale())}</span>
              <span className={`w-12 uppercase ${LEVEL_STYLE[l.level]}`}>{l.level}</span>
              <span className="min-w-0 break-words">
                <span className="text-accent/80">[{l.module}]</span> {l.message}
                {l.stack && (
                  <details>
                    <summary className="cursor-pointer text-faint">stack</summary>
                    <pre className="whitespace-pre-wrap text-faint">{l.stack}</pre>
                  </details>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
