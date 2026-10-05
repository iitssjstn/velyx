import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Bookmark, ChevronDown, Film, Heart, Inbox, Layers, House, LogOut, Menu, Search, Server, CircleUser, ShieldCheck, Tags, Tv, X } from 'lucide-react';
import { api } from '../lib/api';
import { displayName, useAuth } from '../lib/auth';
import { Logo } from './Logo';
import { Avatar } from './Avatar';
import { useT, type MessageKey } from '../i18n';
import { QuickSearch } from './QuickSearch';
import { AppBackButton, InstallApp } from './InstallApp';
import { serversPage } from '../lib/vidalune';
import { useScrollToTopOnNavigate } from '../lib/hooks';
import { DISCOVER_ROWS, type SeerrResult } from './Discover';
import type { Genre } from '../lib/types';

const NAV: Array<{ to: string; label: MessageKey; icon: typeof House; end?: boolean }> = [
  { to: '/', label: 'nav.home', icon: House, end: true },
  { to: '/movies', label: 'nav.movies', icon: Film },
  { to: '/shows', label: 'nav.tvShows', icon: Tv },
  { to: '/genres', label: 'nav.genres', icon: Tags },
  { to: '/collections', label: 'nav.collections', icon: Layers },
  { to: '/watchlist', label: 'nav.watchlist', icon: Bookmark },
  { to: '/favorites', label: 'nav.favorites', icon: Heart },
  { to: '/account', label: 'nav.account', icon: CircleUser },
];
const TOP_NAV_PATHS = new Set(['/', '/movies', '/shows', '/genres', '/collections']);
type GenreKind = 'movies' | 'shows';
type GenreChoice = { key: string; name: string; localId?: number; seerrId?: number };
const genreKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();

function GenreDropdown() {
  const { t } = useT();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const movies = useQuery({ queryKey: ['genres', 'movies'], queryFn: () => api.get<Genre[]>('/api/genres?type=movies'), enabled: open, staleTime: 5 * 60_000 });
  const shows = useQuery({ queryKey: ['genres', 'shows'], queryFn: () => api.get<Genre[]>('/api/genres?type=shows'), enabled: open, staleTime: 5 * 60_000 });
  const seerrStatus = useQuery({ queryKey: ['seerr', 'status'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), enabled: open && !!user, staleTime: 5 * 60_000 });
  const genreRows = DISCOVER_ROWS.filter((entry) => entry.genre !== undefined && (entry.row === 'movies' || entry.row === 'tv'));
  const checks = useQueries({
    queries: genreRows.map((entry) => ({
      queryKey: ['seerr', 'genre-index', entry.row, entry.genre],
      queryFn: () => api.get<{ results: SeerrResult[] }>(`/api/seerr/discover?row=${entry.row}&genre=${entry.genre}&page=1`),
      enabled: open && Boolean(seerrStatus.data?.enabled),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const choices = (kind: GenreKind, local: Genre[] | undefined): GenreChoice[] => {
    const row = kind === 'movies' ? 'movies' : 'tv';
    const merged = new Map<string, GenreChoice>();
    for (const genre of local ?? []) {
      const key = genreKey(genre.name);
      merged.set(key, { key, name: genre.name, localId: genre.id });
    }
    if (seerrStatus.data?.enabled) {
      genreRows.forEach((entry, index) => {
        if (entry.row !== row || !entry.genre || !checks[index]?.data?.results.length) return;
        const name = entry.genreName ? t(entry.genreName) : String(entry.genre);
        const key = genreKey(name);
        const existing = merged.get(key);
        merged.set(key, existing ? { ...existing, seerrId: entry.genre } : { key, name, seerrId: entry.genre });
      });
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const movieChoices = choices('movies', movies.data);
  const showChoices = choices('shows', shows.data);
  const loading = movies.isLoading || shows.isLoading || seerrStatus.isLoading || (seerrStatus.data?.enabled && checks.some((query) => query.isLoading));
  const href = (kind: GenreKind, category?: GenreChoice) => `/genres?scope=all&kind=${kind}${category?.localId ? `&localGenre=${category.localId}` : ''}${category?.seerrId ? `&seerrGenre=${category.seerrId}` : ''}`;
  const close = (event: React.MouseEvent<HTMLAnchorElement>) => event.currentTarget.closest('details')?.removeAttribute('open');

  return (
    <details className="group relative shrink-0" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={t('nav.genres')} className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-xs whitespace-nowrap text-muted transition-colors hover:bg-raised/60 hover:text-ink lg:px-2.5 lg:text-sm [&::-webkit-details-marker]:hidden">
        <Tags className="size-4" />{t('nav.genres')}<ChevronDown className="size-3.5" />
      </summary>
      <div className="absolute top-full left-0 z-50 mt-2 max-h-[min(70vh,36rem)] w-[min(88vw,38rem)] overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink">{t('browse.categoryTitle')}</span>
          <Link to={href('movies')} onClick={close} className="text-xs font-medium text-accent hover:text-ink">{t('browse.allCategories')}</Link>
        </div>
        {loading ? <p className="py-4 text-sm text-muted">{t('common.loading')}</p> : (
          <div className="grid gap-5 sm:grid-cols-2">
            {([
              { kind: 'movies' as const, label: t('nav.movies'), items: movieChoices },
              { kind: 'shows' as const, label: t('nav.tvShows'), items: showChoices },
            ]).map((group) => (
              <section key={group.kind}>
                <h3 className="mb-2 text-xs font-semibold text-faint">{group.label}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map((genre) => (
                    <Link key={genre.key} to={href(group.kind, genre)} onClick={close} className="rounded-lg border border-line/70 px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent/60 hover:bg-raised hover:text-ink">
                      {genre.name}
                    </Link>
                  ))}
                  {group.items.length === 0 && <p className="text-xs text-faint">{t('browse.noCategories')}</p>}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function NavItems({ onNavigate, horizontal = false }: { onNavigate?: () => void; horizontal?: boolean }) {
  const { user } = useAuth();
  const { t } = useT();
  // Requests only when Seerr is set up on this server.
  const seerr = useQuery({ queryKey: ['seerr', 'status'], queryFn: () => api.get<{ enabled: boolean }>('/api/seerr'), staleTime: 5 * 60_000, enabled: !!user });
  const primary = horizontal ? NAV.filter(({ to }) => TOP_NAV_PATHS.has(to)) : NAV;
  const base = seerr.data?.enabled ? [...primary, { to: '/requests', label: 'nav.requests' as const, icon: Inbox }, ...(horizontal ? [] : [NAV[NAV.length - 1]!])] : primary;
  const items = !horizontal && user?.role === 'admin' ? [...base, { to: '/admin', label: 'nav.admin' as const, icon: ShieldCheck }] : base;
  return (
    <nav className={horizontal ? 'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden' : 'flex flex-col gap-1'} aria-label={t('nav.main')}>
      {items.map(({ to, label, icon: Icon, end }) => horizontal && to === '/genres' ? <GenreDropdown key={to} /> : (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          onClick={onNavigate}
          className={({ isActive }) =>
            horizontal
              ? `group flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-xs whitespace-nowrap transition-colors lg:px-2.5 lg:text-sm ${isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'}`
              : `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.95rem] transition-colors ${isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'}`
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={`${horizontal ? 'size-4' : 'size-[1.15rem]'} ${isActive ? 'text-accent' : ''}`} strokeWidth={isActive ? 2.3 : 1.9} />
              {t(label)}
            </>
          )}
        </NavLink>
      ))}
      {!horizontal && <ServerSwitch />}
    </nav>
  );
}

/** This server, and the way to your other servers on app.vidalune.com (when it is linked). */
function ServerSwitch({ horizontal = false }: { horizontal?: boolean }) {
  const { server } = useAuth();
  const { t } = useT();
  if (!server?.vidalune) return null;
  if (horizontal) {
    return (
      <a href={serversPage(server.vidalune.appUrl)} title={`${server.name} · ${t('nav.otherServers')}`} aria-label={`${t('nav.servers')}: ${server.name}`} className="flex h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-raised/60 hover:text-ink">
        <Server className="size-[1.1rem] text-accent" strokeWidth={2} aria-hidden="true" />
        <span className="hidden max-w-28 truncate 2xl:inline">{server.name}</span>
        <ArrowLeftRight className="size-4" strokeWidth={1.9} aria-hidden="true" />
      </a>
    );
  }
  return (
    <div className="mt-5 border-t border-line/50 pt-4">
      <p className="px-3 pb-1.5 text-xs font-medium tracking-wide text-faint uppercase">{t('nav.servers')}</p>
      <p className="flex items-center gap-3 rounded-lg px-3 py-2 text-[0.95rem] text-ink">
        <Server className="size-[1.15rem] text-accent" strokeWidth={2.1} aria-hidden="true" />
        <span className="truncate">{server.name}</span>
      </p>
      <a
        href={serversPage(server.vidalune.appUrl)}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-[0.95rem] text-muted transition-colors hover:bg-raised/60 hover:text-ink"
      >
        <ArrowLeftRight className="size-[1.15rem]" strokeWidth={1.9} aria-hidden="true" />
        {t('nav.otherServers')}
      </a>
    </div>
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

function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  if (!user) return null;
  return (
    <details className="group relative shrink-0">
      <summary aria-label={t('nav.account')} className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-raised/60 hover:text-ink [&::-webkit-details-marker]:hidden">
        <Avatar user={user} size={30} />
        <span className="hidden md:inline">{t('nav.account')}</span>
        <ChevronDown className="hidden size-3.5 xl:block" />
      </summary>
      <div className="absolute top-full right-0 z-50 mt-2 w-56 rounded-xl border border-line bg-surface p-2 shadow-2xl">
        <div className="border-b border-line/70 px-3 py-2">
          <p className="truncate text-sm font-medium text-ink">{displayName(user)}</p>
          <p className="text-xs text-faint">{user.role === 'admin' ? t('roles.admin') : t('roles.user')}</p>
        </div>
        <NavLink to="/account" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-raised hover:text-ink"><CircleUser className="size-4" />{t('nav.account')}</NavLink>
        <NavLink to="/watchlist" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-raised hover:text-ink"><Bookmark className="size-4" />{t('nav.watchlist')}</NavLink>
        <NavLink to="/favorites" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-raised hover:text-ink"><Heart className="size-4" />{t('nav.favorites')}</NavLink>
        <InstallApp />
        <button type="button" onClick={async (event) => { event.currentTarget.closest('details')?.removeAttribute('open'); await logout(); navigate('/login'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-raised hover:text-ink">
          <LogOut className="size-4" />{t('auth.signOut')}
        </button>
      </div>
    </details>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const location = useLocation();
  const { t } = useT();
  const { user } = useAuth();

  useEffect(() => setOpen(false), [location.pathname]);
  useScrollToTopOnNavigate();

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
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 hidden h-16 items-center gap-3 border-b border-line/60 bg-bg/95 px-3 backdrop-blur md:flex xl:px-6">
        <AppBackButton className="-ml-1" />
        <Logo size="sm" />
        <NavItems horizontal />
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => setSearching(true)} className="grid size-10 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-raised/60 hover:text-ink" aria-label={t('nav.searchVidalune')} title={t('nav.searchVidalune')}>
            <Search className="size-[1.1rem]" />
          </button>
          <ServerSwitch horizontal />
          <AccountMenu />
          {user?.role === 'admin' && <NavLink to="/admin" title={t('nav.admin')} aria-label={t('nav.admin')} className="flex h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-raised/60 hover:text-ink"><ShieldCheck className="size-[1.1rem]" /><span className="hidden lg:inline">{t('nav.admin')}</span></NavLink>}
        </div>
      </header>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/50 bg-bg/90 px-4 backdrop-blur md:hidden">
        <div className="flex items-center gap-1">
          <AppBackButton className="-ml-3" />
          <Logo size="sm" />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setSearching(true)} className="grid size-10 place-items-center rounded-full text-muted" aria-label={t('nav.searchVidalune')}>
            <Search className="size-5" />
          </button>
          <button type="button" className="grid size-10 place-items-center rounded-full text-muted" onClick={() => setOpen(true)} aria-label={t('nav.openMenu')}>
            <Menu className="size-5" />
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t('nav.menu')}>
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
              <InstallApp onDone={() => setOpen(false)} />
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
