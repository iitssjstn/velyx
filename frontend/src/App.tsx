import { lazy, Suspense, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { FullscreenLoader, ErrorState } from './components/States';
import { HomePage } from './pages/Home';
import { BrowsePage } from './pages/Browse';
import { MoviePage } from './pages/MovieDetail';
import { ShowPage } from './pages/ShowDetail';
import { FavoritesPage, WatchlistPage } from './pages/Favorites';
import { SearchPage } from './pages/Search';
import { NotFoundPage } from './pages/NotFound';
import { CollectionPage, CollectionsPage } from './pages/Collections';

import { PlayerHost, PlayRoute } from './components/PlayerHost';
import { useT } from './i18n';
import { PlaybackSessionProvider } from './lib/playback-session';
import { hideSplash } from './lib/splash';

// The admin area is loaded on demand to keep the initial bundle small (the player too, see PlayerHost).
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
// Pages that are not the first thing someone sees come in their own files: the first script stays
// small. They are fetched ahead once the first screen stands (see below), so opening one does not wait.
const pages = {
  setup: () => import('./pages/Setup'),
  login: () => import('./pages/Login'),
  requests: () => import('./pages/Requests'),
  request: () => import('./pages/RequestDetail'),
  settings: () => import('./pages/Settings'),
  genres: () => import('./pages/Genres'),
  discoverRow: () => import('./pages/DiscoverRow'),
};
const SetupPage = lazy(() => pages.setup().then((m) => ({ default: m.SetupPage })));
const LoginPage = lazy(() => pages.login().then((m) => ({ default: m.LoginPage })));
const RequestsPage = lazy(() => pages.requests().then((m) => ({ default: m.RequestsPage })));
const RequestPage = lazy(() => pages.request().then((m) => ({ default: m.RequestPage })));
const SettingsPage = lazy(() => pages.settings().then((m) => ({ default: m.SettingsPage })));
const OldSettingsRedirect = lazy(() => pages.settings().then((m) => ({ default: m.OldSettingsRedirect })));
const GenresPage = lazy(() => pages.genres().then((m) => ({ default: m.GenresPage })));
const DiscoverRowPage = lazy(() => pages.discoverRow().then((m) => ({ default: m.DiscoverRowPage })));
/** What a signed-in user can open from the first screen. */
const AHEAD = [pages.requests, pages.request, pages.settings, pages.genres, pages.discoverRow];

/** After signing in, continue to the page the user originally asked for (same-origin paths only). */
function AfterLogin() {
  const next = new URLSearchParams(useLocation().search).get('next');
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return <Navigate to={safe} replace />;
}

export function App() {
  const { server, user, loading, error } = useAuth();
  const location = useLocation();
  const { t } = useT();

  // The opening screen fades out once the first screen has its data (its requests start before
  // this runs, so the page is not shown half loaded).
  const queryClient = useQueryClient();
  useEffect(() => {
    if (loading) return;
    const check = () => {
      if (queryClient.isFetching() === 0) hideSplash();
    };
    check();
    return queryClient.getQueryCache().subscribe(check);
  }, [loading, queryClient]);

  // Signed in and the first screen stands: the other pages are fetched in a quiet moment.
  const signedIn = Boolean(user);
  useEffect(() => {
    if (loading || !signedIn) return;
    const fetchAhead = () => AHEAD.forEach((load) => void load().catch(() => undefined));
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(fetchAhead, { timeout: 5000 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(fetchAhead, 2000);
    return () => clearTimeout(timer);
  }, [loading, signedIn]);

  useEffect(() => {
    document.title = server?.name && server.name !== 'Vidalune' ? `${server.name} · Vidalune` : 'Vidalune';
  }, [server?.name]);

  if (loading) return <FullscreenLoader />;
  if (!server) return <ErrorState title={t('errors.notReachable')} error={error} fullscreen />;
  if (server.setupRequired) {
    return (
      <Suspense fallback={<FullscreenLoader />}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      </Suspense>
    );
  }
  if (!user) {
    const next = location.pathname !== '/' && location.pathname !== '/login' ? `?next=${encodeURIComponent(location.pathname + location.search)}` : '';
    return (
      <Suspense fallback={<FullscreenLoader />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to={`/login${next}`} replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <PlaybackSessionProvider>
    <Suspense fallback={<FullscreenLoader />}>
      <Routes>
        <Route path="/play/:kind/:id" element={<PlayRoute />} />
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/movies" element={<BrowsePage key="movies" kind="movies" />} />
          <Route path="/shows" element={<BrowsePage key="shows" kind="shows" />} />
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/discover/:row" element={<DiscoverRowPage />} />
          <Route path="/movies/:id" element={<MoviePage />} />
          <Route path="/shows/:id" element={<ShowPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/collections/:id" element={<CollectionPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/request/:type/:id" element={<RequestPage />} />
          <Route path="/account/*" element={<SettingsPage />} />
          <Route path="/settings/*" element={<OldSettingsRedirect />} />
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/*" element={user.role === 'admin' ? <AdminLayout /> : <NotFoundPage />} />
          <Route path="/login" element={<AfterLogin />} />
          {/* Right after the setup wizard the admin lands here: continue to adding libraries. */}
          <Route path="/setup" element={<Navigate to={user.role === 'admin' ? '/admin/libraries?welcome=1' : '/'} replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <PlayerHost />
    </Suspense>
    </PlaybackSessionProvider>
  );
}
