/** The Vidalune account service: signing in with a Vidalune account and listing its servers. */
export const CLOUD_URL = 'https://vidalune.com';

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
    signOut: (token: string) => request<{ ok: true }>('POST', '/api/logout', token).catch(() => undefined),
  };
}

/** The addresses to try for a server: its own first, then the relay. */
export function serverAddresses(s: CloudServer): string[] {
  return [s.url, s.relayUrl].filter((u): u is string => !!u);
}

/** Online servers with an address first, then the rest, each by name. */
export function sortServers(list: CloudServer[]): CloudServer[] {
  const rank = (s: CloudServer) => (serverAddresses(s).length ? 0 : 2) + (s.online ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
