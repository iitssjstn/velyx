import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import { onlineManager } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { createApi, type Api } from './api';
import { appUserAgent } from './auth';
import { connectionState, type Connection } from './connection';
import { pickLanguage, translator, type Language, type Translate } from './i18n';
import type { ServerInfo } from './server';
import type { User } from './types';

const STORE_KEY = 'velyx.session';

interface Stored {
  serverUrl: string;
  serverName: string;
  serverVersion: string;
  token: string | null;
  user: User | null;
}

interface SessionValue {
  ready: boolean;
  serverUrl: string | null;
  serverName: string | null;
  serverVersion: string | null;
  user: User | null;
  signedIn: boolean;
  api: Api;
  /** This device's name as the server lists it ("Pixel 8"). */
  deviceName: string;
  appVersion: string;
  t: Translate;
  language: Language;
  setServer(url: string, info: ServerInfo): Promise<void>;
  forgetServer(): Promise<void>;
  signIn(token: string, user: User): Promise<void>;
  /** The account after a change (name, language) — kept on the device too. */
  updateUser(user: User): Promise<void>;
  /** The server stopped accepting this device's sign-in (signed out elsewhere, password changed, account disabled). */
  sessionEnded: boolean;
  /** Whether the device is online and the server answers (for the connection banner). */
  connection: Connection;
  /** Ends the session here (and on the server, when it can be reached). */
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
const DEVICE_NAME = (Device.modelName ?? Device.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android')).slice(0, 64);
const USER_AGENT = appUserAgent(APP_VERSION, Platform.OS === 'ios' ? 'iOS' : 'Android', Device.osVersion, DEVICE_NAME);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<Stored | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [serverReachable, setServerReachable] = useState(true);
  const [deviceOnline, setDeviceOnline] = useState<boolean | null>(null);

  // The device's own network. Lists pause while it is offline and load again when it comes back.
  useEffect(() => {
    const apply = (state: Network.NetworkState) => {
      // Only "no network at all" counts: a home server on Wi-Fi without internet must keep working.
      const online = state.isConnected === false ? false : state.isConnected === true ? true : null;
      setDeviceOnline(online);
      onlineManager.setOnline(online !== false);
    };
    void Network.getNetworkStateAsync().then(apply).catch(() => undefined);
    const sub = Network.addNetworkStateListener(apply);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => setStored(raw ? (JSON.parse(raw) as Stored) : null))
      .catch(() => setStored(null))
      .finally(() => setReady(true));
  }, []);

  const save = useCallback(async (next: Stored | null) => {
    setStored(next);
    if (next) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(STORE_KEY);
  }, []);

  // The account's language wins; before signing in, the phone's.
  const language: Language = stored?.user?.language ?? pickLanguage(getLocales().map((l) => l.languageTag));

  const api = useMemo(
    () =>
      createApi({
        baseUrl: stored?.serverUrl ?? '',
        token: stored?.token ?? null,
        userAgent: USER_AGENT,
        // Signed out elsewhere (or the account was disabled): back to the sign-in screen, which says so.
        onReachable: (reachable) => setServerReachable(reachable),
        onUnauthorized: () => {
          setSessionEnded(true);
          void save(stored ? { ...stored, token: null, user: null } : null);
        },
      }),
    [stored, save],
  );

  // The account as the server knows it now (the name or language may have changed on the website).
  const signedIn = Boolean(stored?.token && stored.user);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api
      .get<{ user: User }>('/api/auth/me')
      .then(({ user }) => {
        if (alive && stored && JSON.stringify(user) !== JSON.stringify(stored.user)) void save({ ...stored, user });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Once per sign-in (and app start), not after every change of the stored session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, stored?.token]);

  const value: SessionValue = {
    ready,
    serverUrl: stored?.serverUrl ?? null,
    serverName: stored?.serverName ?? null,
    serverVersion: stored?.serverVersion ?? null,
    user: stored?.user ?? null,
    signedIn,
    sessionEnded,
    connection: connectionState(deviceOnline, serverReachable),
    api,
    deviceName: DEVICE_NAME,
    appVersion: APP_VERSION,
    t: translator(language),
    language,
    setServer: (url, info) => save({ serverUrl: url, serverName: info.name, serverVersion: info.version, token: null, user: null }),
    forgetServer: () => save(null),
    signIn: (token, user) => {
      setSessionEnded(false);
      return save(stored ? { ...stored, token, user } : null);
    },
    updateUser: (user) => save(stored ? { ...stored, user } : null),
    signOut: async () => {
      try {
        await api.post('/api/auth/logout');
      } catch {
        /* the token simply expires on the server */
      }
      await save(stored ? { ...stored, token: null, user: null } : null);
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
