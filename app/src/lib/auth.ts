import type { Api } from './api';
import type { User } from './types';

export interface SignedIn {
  token: string;
  expiresAt: number;
  user: User;
}

export function signInWithPassword(api: Api, username: string, password: string, deviceName: string): Promise<SignedIn> {
  return api.post<SignedIn>('/api/auth/app/login', { username: username.trim(), password, deviceName });
}

export interface Pairing {
  /** "K7M-2QX": shown to the user, entered on the website. */
  code: string;
  pollToken: string;
  expiresAt: number;
  /** Seconds between checks. */
  interval: number;
}

export function startPairing(api: Api, deviceName: string): Promise<Pairing> {
  return api.post<Pairing>('/api/auth/pair/start', { deviceName });
}

export type PairingState = { status: 'pending' } | ({ status: 'approved' } & SignedIn) | { status: 'expired' };

/** Asks once whether the code was confirmed on the website. */
export async function checkPairing(api: Api, pollToken: string): Promise<PairingState> {
  try {
    return await api.post<PairingState>('/api/auth/pair/poll', { pollToken });
  } catch (err) {
    if ((err as { status?: number }).status === 410) return { status: 'expired' };
    throw err;
  }
}

/** "VidaluneApp/0.8.1 (Android 15; Pixel 8)" — how the server recognises the app. */
export function appUserAgent(version: string, os: string, osVersion: string | number | null, deviceName: string | null): string {
  const parts = [`${os}${osVersion ? ` ${osVersion}` : ''}`, deviceName].filter(Boolean);
  return `VidaluneApp/${version} (${parts.join('; ')})`;
}
