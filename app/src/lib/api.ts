export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export interface ApiConfig {
  baseUrl: string;
  token: string | null;
  /** "VelyxApp/0.8.1 (Android 15; Pixel 8)": tells the server this is the app. */
  userAgent: string;
  fetchImpl?: Fetch;
  /** Called when the server no longer accepts the token (signed out elsewhere, account disabled). */
  onUnauthorized?: () => void;
  /** Called after every request: whether the server answered at all (any HTTP status counts). */
  onReachable?: (reachable: boolean) => void;
  /** A request without an answer after this many milliseconds counts as unreachable (default 15 s). */
  timeoutMs?: number;
}

/** Status 0: no answer — the device is offline, the server is down, or it took too long. */
export const NO_ANSWER = 0;

export interface Api {
  readonly baseUrl: string;
  /** Headers for requests the app makes itself: images, video, subtitles. */
  headers(): Record<string, string>;
  /** Absolute address of a server path ("/api/images/w342/a.jpg"). */
  url(path: string): string;
  /** `signal` cancels the request (a search superseded by the next one). */
  get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function createApi(config: ApiConfig): Api {
  const fetchImpl = config.fetchImpl ?? fetch;
  // One object for the whole session: images compare their source, and a new object on every
  // render would make them load again.
  const fixedHeaders: Record<string, string> = Object.freeze({
    'User-Agent': config.userAgent,
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
  }) as Record<string, string>;
  const headers = (): Record<string, string> => fixedHeaders;
  const url = (path: string) => `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    // A request never hangs: without an answer in time it counts as unreachable. A signal from the
    // caller (a search replaced by the next one) cancels it too.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), config.timeoutMs ?? 15_000);
    const cancel = () => timeout.abort();
    if (signal?.aborted) timeout.abort();
    else signal?.addEventListener('abort', cancel);
    let res: Response;
    let text: string;
    try {
      res = await fetchImpl(url(path), {
        method,
        headers: { ...headers(), Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: timeout.signal,
      });
      text = await res.text();
    } catch (err) {
      // Cancelled on purpose: not a connection problem.
      if (signal?.aborted) throw err;
      config.onReachable?.(false);
      throw new ApiError(timeout.signal.aborted ? 'timeout' : 'unreachable', NO_ANSWER);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
    config.onReachable?.(true);
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      if (res.status === 401 && config.token) config.onUnauthorized?.();
      const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      throw new ApiError(message, res.status);
    }
    return data as T;
  }

  return {
    baseUrl: config.baseUrl,
    headers,
    url,
    get: (path, options) => request('GET', path, undefined, options?.signal),
    post: (path, body) => request('POST', path, body ?? {}),
    put: (path, body) => request('PUT', path, body ?? {}),
    del: (path) => request('DELETE', path),
  };
}
