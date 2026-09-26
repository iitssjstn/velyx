import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { FullscreenLoader, ErrorState } from './components/States';
import { SetupPage } from './pages/Setup';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { BrowsePage } from './pages/Browse';
import { MoviePage } from './pages/MovieDetail';
import { ShowPage } from './pages/ShowDetail';
import { FavoritesPage, WatchlistPage } from './pages/Favorites';
import { SearchPage } from './pages/Search';
import { SettingsPage } from './pages/Settings';
import { NotFoundPage } from './pages/NotFound';

// The player and the admin area are loaded on demand to keep the initial bundle small.
const PlayerPage = lazy(() => import('./pages/Player'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));

/** After signing in, continue to the page the user originally asked for (same-origin paths only). */
function AfterLogin() {
  const next = new URLSearchParams(useLocation().search).get('next');
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return <Navigate to={safe} replace />;
}

export function App() {
  const { server, user, loading, error } = useAuth();
  const location = useLocation();

  useEffect(() => {
    document.title = server?.name && server.name !== 'Velyx' ? `${server.name} · Velyx` : 'Velyx';
  }, [server?.name]);

  if (loading) return <FullscreenLoader />;
  if (!server) return <ErrorState title="Velyx is not reachable" error={error} fullscreen />;
  if (server.setupRequired) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }
  if (!user) {
    const next = location.pathname !== '/' && location.pathname !== '/login' ? `?next=${encodeURIComponent(location.pathname + location.search)}` : '';
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to={`/login${next}`} replace />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<FullscreenLoader />}>
      <Routes>
        <Route path="/play/:kind/:id" element={<PlayerPage />} />
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/movies" element={<BrowsePage kind="movies" />} />
          <Route path="/shows" element={<BrowsePage kind="shows" />} />
          <Route path="/movies/:id" element={<MoviePage />} />
          <Route path="/shows/:id" element={<ShowPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/*" element={user.role === 'admin' ? <AdminLayout /> : <NotFoundPage />} />
          <Route path="/login" element={<AfterLogin />} />
          {/* Right after the setup wizard the admin lands here: continue to adding libraries. */}
          <Route path="/setup" element={<Navigate to={user.role === 'admin' ? '/admin/libraries?welcome=1' : '/'} replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
