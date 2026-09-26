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

const TABS = [
  { to: 'dashboard', label: 'Dashboard' },
  { to: 'activity', label: 'Activity' },
  { to: 'libraries', label: 'Libraries' },
  { to: 'users', label: 'Users' },
  { to: 'metadata', label: 'Metadata' },
  { to: 'health', label: 'Library health' },
  { to: 'intros', label: 'Intros & credits' },
  { to: 'server', label: 'Server' },
  { to: 'logs', label: 'Logs' },
  { to: 'audit', label: 'Audit log' },
  { to: 'backup', label: 'Backup' },
];

export default function AdminLayout() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Administration</h1>
      <nav className="no-scrollbar mt-6 mb-8 flex gap-1 overflow-x-auto border-b border-line/60" aria-label="Admin sections">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={`/admin/${t.to}`}
            className={({ isActive }) => `-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm transition ${isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
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
