import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { createApi, type Api } from './api';
import { appUserAgent } from './auth';
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
        // Signed out elsewhere (or the account was disabled): back to the sign-in screen.
        onUnauthorized: () => void save(stored ? { ...stored, token: null, user: null } : null),
      }),
    [stored, save],
  );

  const value: SessionValue = {
    ready,
    serverUrl: stored?.serverUrl ?? null,
    serverName: stored?.serverName ?? null,
    serverVersion: stored?.serverVersion ?? null,
    user: stored?.user ?? null,
    signedIn: Boolean(stored?.token && stored.user),
    api,
    deviceName: DEVICE_NAME,
    appVersion: APP_VERSION,
    t: translator(language),
    language,
    setServer: (url, info) => save({ serverUrl: url, serverName: info.name, serverVersion: info.version, token: null, user: null }),
    forgetServer: () => save(null),
    signIn: (token, user) => save(stored ? { ...stored, token, user } : null),
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
