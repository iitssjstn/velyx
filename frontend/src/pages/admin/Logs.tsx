import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import type { LogEntry } from '../../lib/types';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader } from '../../components/States';

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
        <select className="input h-9 w-auto py-0 text-sm" value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="Level">
          <option value="all">All levels</option>
          <option value="warn">Warnings and errors</option>
          <option value="error">Errors only</option>
        </select>
        <input className="input h-9 max-w-xs py-0 text-sm" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter logs" />
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={live} onChange={(e) => setLive(e.target.checked)} /> Auto-refresh
        </label>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => q.refetch()}>Refresh</Button>
      </div>
      <p className="text-xs text-faint">The most recent 500 entries since the server started. Full logs: <code>docker compose logs velyx</code>.</p>
      <div className="panel max-h-[65vh] overflow-auto p-2 font-mono text-xs">
        {rows.length === 0 ? (
          <p className="p-4 text-muted">No log entries.</p>
        ) : (
          rows.map((l, i) => (
            <div key={i} className="grid grid-cols-[auto_auto_1fr] gap-3 rounded px-2 py-1 hover:bg-raised">
              <span className="text-faint tabular-nums">{new Date(l.time).toLocaleTimeString()}</span>
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
