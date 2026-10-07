/** The Vidalune account service: signing in with a Vidalune account and listing its servers. */
export const CLOUD_URL = 'https://vidalune.com';

/** Where the app keeps the Vidalune account it signed in with. */
export const CLOUD_ACCOUNT_KEY = 'vidalune.cloudAccount';
/** A server whose sign-in fell back to a password: once signed in, connect the Vidalune account there. */
export const PENDING_CONNECT_KEY = 'vidalune.pendingConnect';

/** Storage the helpers below use (SecureStore in the app, a map in tests). */
export interface KeyStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * After signing in on a server by password because the Vidalune account did not know that user:
 * connect them, so next time the Vidalune account alone is enough. Quietly does nothing when there
 * is nothing to connect or it does not work.
 */
export async function connectPending(store: KeyStore, post: (path: string, body: unknown) => Promise<unknown>, cloud = createCloud()): Promise<boolean> {
  const serverId = await store.getItemAsync(PENDING_CONNECT_KEY);
  if (!serverId) return false;
  await store.deleteItemAsync(PENDING_CONNECT_KEY);
  try {
    const account = JSON.parse((await store.getItemAsync(CLOUD_ACCOUNT_KEY)) ?? 'null') as CloudAccount | null;
    if (!account) return false;
    const { ticket } = await cloud.open(account.token, serverId);
    await post('/api/account/cloud/claim', { ticket });
    return true;
  } catch {
    return false;
  }
}

export interface CloudServer {
  id: string;
  name: string;
  version: string;
  /** The address the server's administrator set (null: none yet). */
  url: string | null;
  /** Its address through the Vidalune relay, while the relay is on. */
  relayUrl?: string | null;
  relayConnected?: boolean;
  online: boolean;
  lastSeenAt: number;
}

export interface CloudAccount {
  email: string;
  token: string;
}

/** What went wrong, for a message in the app's language. */
export type CloudProblem = 'wrong' | 'exists' | 'invalid' | 'tooMany' | 'signedOut' | 'unreachable' | 'failed';

export class CloudError extends Error {
  constructor(readonly problem: CloudProblem) {
    super(problem);
  }
}

const problemFor = (status: number): CloudProblem =>
  status === 401 ? 'wrong' : status === 409 ? 'exists' : status === 400 ? 'invalid' : status === 429 ? 'tooMany' : 'failed';

export function createCloud(fetchImpl: typeof fetch = fetch, baseUrl = CLOUD_URL, timeoutMs = 15_000) {
  async function request<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new CloudError('unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new CloudError(res.status === 401 && token ? 'signedOut' : problemFor(res.status));
    return (await res.json()) as T;
  }

  return {
    signIn: (email: string, password: string) => request<CloudAccount>('POST', '/api/login', null, { email: email.trim(), password, client: 'app' }),
    signUp: (email: string, password: string) => request<CloudAccount>('POST', '/api/account', null, { email: email.trim(), password, client: 'app' }),
    servers: (token: string) => request<CloudServer[]>('GET', '/api/servers', token),
    /** A one-time ticket to sign in on a server, and the addresses to try (its own first). */
    open: (token: string, serverId: string) => request<{ ticket: string; addresses: string[] }>('POST', `/api/servers/${encodeURIComponent(serverId)}/open`, token),
    signOut: (token: string) => request<{ ok: true }>('POST', '/api/logout', token).catch(() => undefined),
  };
}

/** Signing in on a server with the Vidalune account did not work: why, as the server said it. */
export class TicketError extends Error {}

/**
 * Signs in on a server with a ticket from the account service: the Vidalune account is the only
 * sign-in. When the server refuses, the reason it gives (already in the account's language).
 */
export async function signInWithTicket(serverUrl: string, ticket: string, deviceName: string, userAgent: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${serverUrl}/api/auth/app/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': userAgent },
    body: JSON.stringify({ ticket, deviceName }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new TicketError(typeof body.error === 'string' && body.error ? body.error : '');
  }
  return (await res.json()) as { token: string; user: import('./types').User };
}

/** The addresses to try for a server: its own first, then the relay. */
export function serverAddresses(s: CloudServer): string[] {
  return [s.url, s.relayUrl].filter((u): u is string => !!u);
}

/**
 * The server the app opens by itself after signing in with the Vidalune account: the one opened last
 * (signed out by the server, back in at once), otherwise the only server there is, when it is online
 * and has an address. Several servers and none opened before: null (the person chooses).
 */
export function autoOpenServer(list: CloudServer[], lastId: string | null): CloudServer | null {
  const usable = list.filter((s) => serverAddresses(s).length > 0);
  const last = lastId ? usable.find((s) => s.id === lastId) : undefined;
  if (last) return last;
  return list.length === 1 && usable.length === 1 && usable[0]!.online ? usable[0]! : null;
}

/** Online servers with an address first, then the rest, each by name. */
export function sortServers(list: CloudServer[]): CloudServer[] {
  const rank = (s: CloudServer) => (serverAddresses(s).length ? 0 : 2) + (s.online ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
