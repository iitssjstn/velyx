import { Navigate, Route, Routes } from 'react-router-dom';
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
import { NotificationsPage, useUnreadNotifications } from './Notifications';
import { CloudPage } from './Cloud';
import { IntegrationsPage } from './Integrations';
import { PlaybackPage } from './Playback';
import { MaintenancePage } from './SettingsPanels';
import { OptimizationPage } from './Optimization';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity, Bell, ChevronDown, Clapperboard, Cloud, DatabaseBackup, Eraser, Gauge, HeartPulse, LayoutDashboard,
  Library, MonitorPlay, Plug, ScrollText, Server, ShieldCheck, Tags, Users, Wrench, type LucideIcon,
} from 'lucide-react';
import { useT, type MessageKey } from '../../i18n';

type Section = { to: string; label: MessageKey; icon: LucideIcon };

/** The admin sections, grouped in the side navigation. */
const GROUPS: Array<{ label: MessageKey; items: Section[] }> = [
  {
    label: 'admin.groups.monitoring',
    items: [
      { to: 'dashboard', label: 'admin.tabs.dashboard', icon: LayoutDashboard },
      { to: 'activity', label: 'admin.tabs.activity', icon: Activity },
      { to: 'logs', label: 'admin.tabs.logs', icon: ScrollText },
      { to: 'audit', label: 'admin.tabs.audit', icon: ShieldCheck },
      { to: 'notifications', label: 'admin.tabs.notifications', icon: Bell },
    ],
  },
  {
    label: 'admin.groups.content',
    items: [
      { to: 'libraries', label: 'admin.tabs.libraries', icon: Library },
      { to: 'metadata', label: 'admin.tabs.metadata', icon: Tags },
      { to: 'health', label: 'admin.tabs.health', icon: HeartPulse },
      { to: 'intros', label: 'admin.tabs.intros', icon: Clapperboard },
      { to: 'playback', label: 'admin.tabs.playback', icon: MonitorPlay },
      { to: 'optimization', label: 'admin.tabs.optimization', icon: Gauge },
      { to: 'cleanup', label: 'admin.tabs.cleanup', icon: Eraser },
    ],
  },
  {
    label: 'admin.groups.integrations',
    items: [
      { to: 'integrations', label: 'admin.tabs.integrations', icon: Plug },
      { to: 'cloud', label: 'admin.tabs.cloud', icon: Cloud },
      { to: 'maintenance', label: 'admin.tabs.maintenance', icon: Wrench },
      { to: 'server', label: 'admin.tabs.server', icon: Server },
      { to: 'backup', label: 'admin.tabs.backup', icon: DatabaseBackup },
    ],
  },
  {
    label: 'admin.groups.users',
    items: [{ to: 'users', label: 'admin.tabs.users', icon: Users }],
  },
];

const SECTIONS = GROUPS.flatMap((g) => g.items);

function SideNav({ unread }: { unread: number }) {
  const { t } = useT();
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <h2 className="mb-2 px-3 text-xs font-semibold tracking-wider text-muted uppercase">{t(group.label)}</h2>
          <ul className="space-y-0.5">
            {group.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={`/admin/${to}`}
                  className={({ isActive }) => `flex items-center gap-3.5 rounded-lg px-3 py-2 text-[15px] transition ${isActive ? 'bg-accent/15 font-medium text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'}`}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t(label)}</span>
                  {to === 'notifications' && unread > 0 && (
                    <span className="rounded-full bg-button px-1.5 py-0.5 text-[10px] font-semibold text-button-ink" aria-label={t('notifications.unread', { count: unread })}>
                      {unread}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function AdminLayout() {
  const { t } = useT();
  const unread = useUnreadNotifications();
  const { pathname } = useLocation();
  // On small screens the navigation folds away behind the current section; it closes after choosing one.
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const current = SECTIONS.find((s) => pathname.startsWith(`/admin/${s.to}`));
  return (
    <div className="md:flex">
      {/* From tablet width on, the navigation sits against the left edge of the screen, the full height below the top bar. */}
      <nav
        aria-label={t('admin.sections')}
        className="no-scrollbar px-4 pt-8 md:sticky md:top-16 md:h-[calc(100dvh-4rem)] md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-line/60 md:bg-surface/50 md:px-4 md:py-6 lg:w-72"
      >
        <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight md:hidden">{t('admin.title')}</h1>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-sections"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-lg border border-line/60 bg-raised/50 px-3 py-2.5 text-sm md:hidden"
        >
          <span>{current ? t(current.label) : t('admin.sections')}</span>
          <ChevronDown className={`size-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <div id="admin-sections" className={`${open ? 'mt-3 block rounded-xl border border-line/60 p-3' : 'hidden'} md:mt-0 md:block md:rounded-none md:border-0 md:p-0`}>
          <SideNav unread={unread} />
        </div>
      </nav>
      <div className="min-w-0 flex-1 px-4 pt-6 sm:px-8 md:pt-8 xl:px-12">
        <div className="mx-auto max-w-[100rem]">
          <h1 className="mb-8 hidden font-display text-3xl font-semibold tracking-tight md:block">{t('admin.title')}</h1>
      <Routes>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="libraries" element={<LibrariesPanel />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="metadata" element={<MetadataPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="intros" element={<SegmentsPage />} />
        <Route path="optimization" element={<OptimizationPage />} />
        <Route path="cleanup" element={<CleanupPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="cloud" element={<CloudPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        {/* Sonarr & Radarr became part of Integrations (with Seerr) in 0.19.53. */}
        <Route path="arr" element={<Navigate to="/admin/integrations" replace />} />
        <Route path="playback" element={<PlaybackPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        {/* The compatibility overview became part of Library health in 0.4.2. */}
        <Route path="compatibility" element={<Navigate to="/admin/health" replace />} />
        <Route path="server" element={<ServerSettingsPanel />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="backup" element={<BackupPage />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
        </div>
      </div>
    </div>
  );
}
