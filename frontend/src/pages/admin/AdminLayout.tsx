import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './Dashboard';
import { LibrariesPanel } from './Libraries';
import { UsersPage } from './Users';
import { MetadataPage } from './Metadata';
import { ServerSettingsPanel } from './ServerSettings';
import { LogsPage } from './Logs';
import { BackupPage } from './Backup';

const TABS = [
  { to: 'dashboard', label: 'Dashboard' },
  { to: 'libraries', label: 'Libraries' },
  { to: 'users', label: 'Users' },
  { to: 'metadata', label: 'Metadata' },
  { to: 'server', label: 'Server' },
  { to: 'logs', label: 'Logs' },
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
        <Route path="libraries" element={<LibrariesPanel />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="metadata" element={<MetadataPage />} />
        <Route path="server" element={<ServerSettingsPanel />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="backup" element={<BackupPage />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </div>
  );
}
