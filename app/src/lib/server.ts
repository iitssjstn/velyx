/** The newest server API this app understands (see `apiVersion` in /api/server/info). */
export const SUPPORTED_API_VERSION = 1;

export interface ServerInfo {
  name: string;
  product: string;
  version: string;
  apiVersion?: number;
  setupRequired: boolean;
}

export type ServerProblem = 'invalid' | 'unreachable' | 'not-velyx' | 'too-old' | 'too-new' | 'setup';

export class ServerError extends Error {
  constructor(readonly problem: ServerProblem) {
    super(problem);
  }
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * The addresses to try for what someone typed: "velyx.example.com", "192.168.1.10:3000" or a
 * full URL copied from the browser ("https://velyx.example.com/movies/12"). Without a scheme,
 * HTTPS is tried first and plain HTTP (usual at home) second.
 */
export function serverCandidates(input: string): string[] {
  const text = input.trim();
  if (!text || /\s/.test(text)) return [];
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const tries = hasScheme ? [text] : [`https://${text}`, `http://${text}`];
  const out: string[] = [];
  for (const t of tries) {
    let url: URL;
    try {
      url = new URL(t);
    } catch {
      return [];
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
    if (!url.hostname) return [];
    // Velyx runs at the root of its address; a page path copied along is dropped.
    out.push(`${url.protocol}//${url.host}`);
  }
  return out;
}

/** Finds the Velyx server behind what someone typed, and checks that this app can talk to it. */
export async function findServer(input: string, fetchImpl: Fetch, timeoutMs = 8000): Promise<{ url: string; info: ServerInfo }> {
  const candidates = serverCandidates(input);
  if (!candidates.length) throw new ServerError('invalid');
  let notVelyx = false;
  for (const url of candidates) {
    let info: ServerInfo;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${url}/api/server/info`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
        if (!res.ok) {
          notVelyx = true;
          continue;
        }
        info = (await res.json()) as ServerInfo;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      continue;
    }
    if (!info || info.product !== 'Velyx') {
      notVelyx = true;
      continue;
    }
    if (!info.apiVersion) throw new ServerError('too-old');
    if (info.apiVersion > SUPPORTED_API_VERSION) throw new ServerError('too-new');
    if (info.setupRequired) throw new ServerError('setup');
    return { url, info };
  }
  throw new ServerError(notVelyx ? 'not-velyx' : 'unreachable');
}
