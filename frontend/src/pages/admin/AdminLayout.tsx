import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './Dashboard';
import { LibrariesPanel } from './Libraries';
import { UsersPage } from './Users';
import { MetadataPage } from './Metadata';
import { ServerSettingsPanel } from './ServerSettings';
import { LogsPage } from './Logs';
import { BackupPage } from './Backup';
import { AuditPage } from './Audit';
import { HealthPage } from './Health';
import { SegmentsPage } from './Segments';
import { ActivityPage } from './Activity';
import { CleanupPage } from './Cleanup';
import { useT, type MessageKey } from '../../i18n';

const TABS: Array<{ to: string; label: MessageKey }> = [
  { to: 'dashboard', label: 'admin.tabs.dashboard' },
  { to: 'activity', label: 'admin.tabs.activity' },
  { to: 'libraries', label: 'admin.tabs.libraries' },
  { to: 'users', label: 'admin.tabs.users' },
  { to: 'metadata', label: 'admin.tabs.metadata' },
  { to: 'health', label: 'admin.tabs.health' },
  { to: 'intros', label: 'admin.tabs.intros' },
  { to: 'cleanup', label: 'admin.tabs.cleanup' },
  { to: 'server', label: 'admin.tabs.server' },
  { to: 'logs', label: 'admin.tabs.logs' },
  { to: 'audit', label: 'admin.tabs.audit' },
  { to: 'backup', label: 'admin.tabs.backup' },
];

export default function AdminLayout() {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('admin.title')}</h1>
      <nav className="no-scrollbar mt-6 mb-8 flex gap-1 overflow-x-auto border-b border-line/60" aria-label={t('admin.sections')}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/admin/${tab.to}`}
            className={({ isActive }) => `-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm transition ${isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t(tab.label)}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="libraries" element={<LibrariesPanel />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="metadata" element={<MetadataPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="intros" element={<SegmentsPage />} />
        <Route path="cleanup" element={<CleanupPage />} />
        {/* The compatibility overview became part of Library health in 0.4.2. */}
        <Route path="compatibility" element={<Navigate to="/admin/health" replace />} />
        <Route path="server" element={<ServerSettingsPanel />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="backup" element={<BackupPage />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </div>
  );
}
