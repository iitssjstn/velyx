import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api';
import { appUserAgent, checkPairing, signInWithPassword, startPairing } from './auth';

function server(respond: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = respond(url, init);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('API client', () => {
  it('sends the token and the app User-Agent, and parses JSON', async () => {
    const { calls, fetchImpl } = server(() => ({ status: 200, body: { ok: true } }));
    const api = createApi({ baseUrl: 'http://vidalune.local', token: 'abc', userAgent: 'VidaluneApp/0.8.1 (Android 15; Pixel 8)', language: 'nl', fetchImpl });
    expect(await api.post('/api/favorites', { movieId: 3 })).toEqual({ ok: true });
    expect(calls[0]!.url).toBe('http://vidalune.local/api/favorites');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer abc', 'User-Agent': 'VidaluneApp/0.8.1 (Android 15; Pixel 8)', 'Accept-Language': 'nl', 'Content-Type': 'application/json' });
    expect(calls[0]!.init.body).toBe('{"movieId":3}');
    // Images and video get the same headers.
    expect(api.headers()).toEqual({ Authorization: 'Bearer abc', 'User-Agent': 'VidaluneApp/0.8.1 (Android 15; Pixel 8)', 'Accept-Language': 'nl' });
    // The same object every time, so images do not load again on every render.
    expect(api.headers()).toBe(api.headers());
    expect(api.url('/api/images/w342/a.jpg')).toBe('http://vidalune.local/api/images/w342/a.jpg');
  });

  it('turns server errors into their message, and reports a token that stopped working', async () => {
    const onUnauthorized = vi.fn();
    const { fetchImpl } = server((url) => (url.endsWith('/me') ? { status: 401, body: { error: 'Not signed in.' } } : { status: 404, body: { error: 'Movie not found.' } }));
    const api = createApi({ baseUrl: 'http://v', token: 'old', userAgent: 'x', fetchImpl, onUnauthorized });
    await expect(api.get('/api/movies/9')).rejects.toMatchObject({ message: 'Movie not found.', status: 404 });
    await expect(api.get('/api/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('says when the server cannot be reached at all', async () => {
    const api = createApi({ baseUrl: 'http://v', token: null, userAgent: 'x', fetchImpl: (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch });
    const err = await api.get('/api/home').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0 });
  });
  it('lets a cancelled request stay cancelled instead of calling the server unreachable', async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response('{}');
    }) as unknown as typeof fetch;
    const api = createApi({ baseUrl: 'http://v', token: null, userAgent: 'x', fetchImpl });
    const controller = new AbortController();
    controller.abort();
    const err = await api.get('/api/search?q=ab', { signal: controller.signal }).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect((err as { status?: number }).status).toBeUndefined();
  });
  it('gives up on a request without an answer and says it timed out', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    const reachable: boolean[] = [];
    const api = createApi({ baseUrl: 'http://v', token: null, userAgent: 'x', fetchImpl, timeoutMs: 20, onReachable: (r) => reachable.push(r) });
    const err = await api.get('/api/home').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, message: 'timeout' });
    expect(reachable).toEqual([false]);
  });

  it('reports that the server answered, also with an error status', async () => {
    const reachable: boolean[] = [];
    const { fetchImpl } = server(() => ({ status: 404, body: { error: 'Not found.' } }));
    const api = createApi({ baseUrl: 'http://v', token: null, userAgent: 'x', fetchImpl, onReachable: (r) => reachable.push(r) });
    await api.get('/api/movies/9').catch(() => undefined);
    expect(reachable).toEqual([true]);
  });
});

describe('signing in', () => {
  it('signs in with a password and the device name', async () => {
    const { calls, fetchImpl } = server(() => ({ status: 200, body: { token: 't', expiresAt: 1, user: { username: 'lotte' } } }));
    const api = createApi({ baseUrl: 'http://v', token: null, userAgent: 'x', fetchImpl });
    const res = await signInWithPassword(api, ' lotte ', 'secret', 'Pixel 8');
    expect(res.token).toBe('t');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ username: 'lotte', password: 'secret', deviceName: 'Pixel 8' });
  });

  it('asks for a code and then whether it was confirmed; an expired code is not an error', async () => {
    let polls = 0;
    const { fetchImpl } = server((url) => {
      if (url.endsWith('/start')) return { status: 200, body: { code: 'K7M-2QX', pollToken: 'p', expiresAt: 1, interval: 3 } };
      polls++;
      if (polls === 1) return { status: 200, body: { status: 'pending' } };
      if (polls === 2) return { status: 200, body: { status: 'approved', token: 't', expiresAt: 1, user: { username: 'lotte' } } };
      return { status: 410, body: { error: 'This code has expired. Ask for a new one.' } };
    });
    const api = createApi({ baseUrl: 'http://v', token: null, userAgent: 'x', fetchImpl });
    expect((await startPairing(api, 'Pixel 8')).code).toBe('K7M-2QX');
    expect(await checkPairing(api, 'p')).toEqual({ status: 'pending' });
    expect(await checkPairing(api, 'p')).toMatchObject({ status: 'approved', token: 't' });
    expect(await checkPairing(api, 'p')).toEqual({ status: 'expired' });
  });

  it('names itself so the server recognises the app', () => {
    expect(appUserAgent('0.8.1', 'Android', '15', 'Pixel 8')).toBe('VidaluneApp/0.8.1 (Android 15; Pixel 8)');
    expect(appUserAgent('0.8.1', 'Android', null, null)).toBe('VidaluneApp/0.8.1 (Android)');
  });
});
