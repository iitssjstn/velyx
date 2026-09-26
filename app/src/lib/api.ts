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
}

export interface Api {
  readonly baseUrl: string;
  /** Headers for requests the app makes itself: images, video, subtitles. */
  headers(): Record<string, string>;
  /** Absolute address of a server path ("/api/images/w342/a.jpg"). */
  url(path: string): string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function createApi(config: ApiConfig): Api {
  const fetchImpl = config.fetchImpl ?? fetch;
  const headers = (): Record<string, string> => ({
    'User-Agent': config.userAgent,
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
  });
  const url = (path: string) => `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(url(path), {
        method,
        headers: { ...headers(), Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('unreachable', 0);
    }
    const text = await res.text();
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
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
    put: (path, body) => request('PUT', path, body ?? {}),
    del: (path) => request('DELETE', path),
  };
}
