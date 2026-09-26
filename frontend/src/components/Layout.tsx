import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bookmark, Film, Heart, Layers, House, LogOut, Menu, Search, Settings, ShieldCheck, Tv, X } from 'lucide-react';
import { displayName, useAuth } from '../lib/auth';
import { Logo } from './Logo';
import { Avatar } from './Avatar';
import { useT, type MessageKey } from '../i18n';
import { QuickSearch } from './QuickSearch';

const NAV: Array<{ to: string; label: MessageKey; icon: typeof House; end?: boolean }> = [
  { to: '/', label: 'nav.home', icon: House, end: true },
  { to: '/movies', label: 'nav.movies', icon: Film },
  { to: '/shows', label: 'nav.tvShows', icon: Tv },
  { to: '/collections', label: 'nav.collections', icon: Layers },
  { to: '/watchlist', label: 'nav.watchlist', icon: Bookmark },
  { to: '/favorites', label: 'nav.favorites', icon: Heart },
  { to: '/settings', label: 'nav.settings', icon: Settings },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const { t } = useT();
  const items = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'nav.admin' as const, icon: ShieldCheck }] : NAV;
  return (
    <nav className="flex flex-col gap-1" aria-label={t('nav.main')}>
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.95rem] transition-colors ${
              isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={`size-[1.15rem] ${isActive ? 'text-accent' : ''}`} strokeWidth={isActive ? 2.3 : 1.9} />
              {t(label)}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function UserBox() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl p-2">
      <Avatar user={user} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName(user)}</p>
        <p className="text-xs text-faint">{user.role === 'admin' ? t('roles.admin') : t('roles.user')}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          await logout();
          navigate('/login');
        }}
        className="grid size-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink"
        aria-label={t('auth.signOut')}
        title={t('auth.signOut')}
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function SearchButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-4 flex w-full items-center gap-3 rounded-lg border border-line/70 bg-surface/60 px-3 py-2 text-left text-sm text-muted transition hover:border-line hover:text-ink"
      aria-label={t('nav.searchVelyx')}
    >
      <Search className="size-4" />
      <span className="flex-1">{t('nav.searchPlaceholder')}</span>
      <kbd className="rounded bg-raised px-1.5 py-0.5 font-mono text-[0.7rem] text-faint">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const location = useLocation();
  const { t } = useT();

  useEffect(() => setOpen(false), [location.pathname]);

  // Ctrl/⌘+K opens search from anywhere; "/" too, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = Boolean(t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)));
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        setSearching((s) => !s);
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !typing) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-dvh lg:pl-60">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line/60 bg-bg/95 px-3 py-5 lg:flex">
        <div className="px-3 pb-6">
          <Logo />
        </div>
        <SearchButton onOpen={() => setSearching(true)} />
        <NavItems />
        <div className="mt-auto">
          <UserBox />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/50 bg-bg/90 px-4 backdrop-blur lg:hidden">
        <Logo size="sm" />
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setSearching(true)} className="grid size-10 place-items-center rounded-full text-muted" aria-label={t('nav.searchVelyx')}>
            <Search className="size-5" />
          </button>
          <button type="button" className="grid size-10 place-items-center rounded-full text-muted" onClick={() => setOpen(true)} aria-label={t('nav.openMenu')}>
            <Menu className="size-5" />
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.menu')}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-surface px-3 py-4 shadow-2xl">
            <div className="flex items-center justify-between px-3 pb-6">
              <Logo size="sm" />
              <button type="button" className="grid size-10 place-items-center rounded-full text-muted" onClick={() => setOpen(false)} aria-label={t('nav.closeMenu')}>
                <X className="size-5" />
              </button>
            </div>
            <NavItems onNavigate={() => setOpen(false)} />
            <div className="mt-auto">
              <UserBox />
            </div>
          </div>
        </div>
      )}

      {searching && <QuickSearch onClose={() => setSearching(false)} />}

      <main id="main" className="pb-16">
        <Outlet />
      </main>
    </div>
  );
}
