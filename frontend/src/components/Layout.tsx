import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Film, Heart, House, LogOut, Menu, Search, Settings, ShieldCheck, Tv, X } from 'lucide-react';
import { displayName, useAuth } from '../lib/auth';
import { Logo } from './Logo';
import { Avatar } from './Avatar';

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/movies', label: 'Movies', icon: Film },
  { to: '/shows', label: 'TV Shows', icon: Tv },
  { to: '/favorites', label: 'Favorites', icon: Heart },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const items = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin', icon: ShieldCheck }] : NAV;
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {items.map(({ to, label, icon: Icon, ...rest }) => (
        <NavLink
          key={to}
          to={to}
          end={'end' in rest ? rest.end : false}
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
              {label}
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
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl p-2">
      <Avatar user={user} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName(user)}</p>
        <p className="text-xs text-faint capitalize">{user.role}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          await logout();
          navigate('/login');
        }}
        className="grid size-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setOpen(false), [location.pathname]);

  // "/" jumps to search from anywhere (except while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !(t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)))) {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="min-h-dvh lg:pl-60">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line/60 bg-bg/95 px-3 py-5 lg:flex">
        <div className="px-3 pb-7">
          <Logo />
        </div>
        <NavItems />
        <div className="mt-auto">
          <UserBox />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/50 bg-bg/90 px-4 backdrop-blur lg:hidden">
        <Logo size="sm" />
        <div className="flex items-center gap-1">
          <NavLink to="/search" className="grid size-10 place-items-center rounded-full text-muted" aria-label="Search">
            <Search className="size-5" />
          </NavLink>
          <button type="button" className="grid size-10 place-items-center rounded-full text-muted" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-surface px-3 py-4 shadow-2xl">
            <div className="flex items-center justify-between px-3 pb-6">
              <Logo size="sm" />
              <button type="button" className="grid size-10 place-items-center rounded-full text-muted" onClick={() => setOpen(false)} aria-label="Close menu">
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

      <main id="main" className="pb-16">
        <Outlet />
      </main>
    </div>
  );
}
