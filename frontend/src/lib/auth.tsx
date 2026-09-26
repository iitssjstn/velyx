import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, onUnauthorized } from './api';
import type { ServerInfo, User } from './types';
import { currentLanguage, isLanguage, setLanguage } from '../i18n';

/** Switches the interface to the signed-in user's language (their choice wins over the browser's). */
async function applyLanguage(user: Pick<User, 'language'>): Promise<void> {
  if (isLanguage(user.language) && user.language !== currentLanguage()) await setLanguage(user.language).catch(() => undefined);
}

interface AuthState {
  server: ServerInfo | undefined;
  user: User | null;
  loading: boolean;
  error: unknown;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
  refetchServer: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const server = useQuery({ queryKey: ['server-info'], queryFn: () => api.get<ServerInfo>('/api/server/info'), staleTime: 60_000 });
  const me = useQuery({
    queryKey: ['me'],
    enabled: server.data !== undefined && !server.data.setupRequired,
    queryFn: async () => {
      try {
        const user = (await api.get<{ user: User }>('/api/auth/me')).user;
        // Show the app in the user's own language from the first screen (loads it before rendering).
        await applyLanguage(user);
        return user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const setUser = useCallback(
    (user: User | null) => {
      qc.setQueryData(['me'], user);
      if (user) void applyLanguage(user);
      if (!user) qc.removeQueries({ predicate: (q) => !['me', 'server-info'].includes(q.queryKey[0] as string) });
    },
    [qc],
  );

  useEffect(() => {
    onUnauthorized(() => {
      if (qc.getQueryData(['me'])) setUser(null);
    });
    return () => onUnauthorized(null);
  }, [qc, setUser]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
    }
  }, [setUser]);

  const value = useMemo<AuthState>(
    () => ({
      server: server.data,
      user: me.data ?? null,
      loading: server.isLoading || (server.data !== undefined && !server.data.setupRequired && me.isLoading),
      error: server.error ?? me.error,
      setUser,
      logout,
      refetchServer: () => void server.refetch(),
    }),
    [server, me.data, me.isLoading, me.error, setUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function displayName(user: Pick<User, 'displayName' | 'username'> | null | undefined): string {
  return user?.displayName?.trim() || user?.username || '';
}

/** Like useAuth, but returns null outside the provider (used by error screens). */
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}
