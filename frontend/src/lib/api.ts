import { currentLanguage, t } from '../i18n';
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: { message?: string; stack?: string },
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Called when any request comes back 401 so the app can return to the login screen. */
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function request<T>(method: Method, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  // The server answers errors in this language until the user is signed in (then in theirs).
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Velyx-Language': currentLanguage() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(t('errors.unreachable'), 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const payload = (data ?? {}) as { error?: string; detail?: { message?: string; stack?: string } };
    if (res.status === 401 && !url.startsWith('/api/auth/login')) unauthorizedHandler?.();
    throw new ApiError(payload.error || t('errors.requestFailed', { status: res.status }), res.status, payload.detail);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return t('errors.generic');
}

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
