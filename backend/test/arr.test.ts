import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeArrUrl } from '../src/services/arr.js';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';

const SONARR_KEY = 'sonarr-api-key-123456';
const RADARR_KEY = 'radarr-api-key-123456';
let calls: Array<{ method: string; path: string; key: string | null }>;
let env: TestEnv;
let admin: string;
const fakeArr = async (input: string, init?: RequestInit) => {
  const url = new URL(input);
  if (url.host !== 'arr.local:8989') throw new Error('network disabled in tests');
  const method = init?.method ?? 'GET';
  const key = ((init?.headers ?? {}) as Record<string, string>)['X-Api-Key'] ?? null;
  calls.push({ method, path: url.pathname + url.search, key });
  if (url.pathname === '/sonarr/api/v3/system/status' || url.pathname === '/radarr/api/v3/system/status') {
    const expected = url.pathname.startsWith('/sonarr') ? SONARR_KEY : RADARR_KEY;
    return key === expected ? Response.json({ version: '4.0.0' }) : new Response(null, { status: 401 });
  }
  const expected = url.pathname.startsWith('/sonarr') ? SONARR_KEY : RADARR_KEY;
  if (key !== expected) return new Response(null, { status: 401 });
  if (method === 'DELETE') return new Response(null, { status: 200 });
  if (url.pathname.endsWith('/series')) return Response.json([{ id: 4, title: 'A Series', year: 2020, monitored: true, status: 'continuing' }]);
  if (url.pathname.endsWith('/movie')) return Response.json([{ id: 8, title: 'A Movie', year: 2021, monitored: false, status: 'released' }]);
  return new Response(null, { status: 404 });
};

beforeEach(async () => {
  calls = [];
  env = await createTestEnv({ fetchImpl: fakeArr });
  admin = await setupAdmin(env.app);
});
afterEach(async () => env.cleanup());

describe('Sonarr and Radarr integration', () => {
  it('normalizes base addresses and rejects credentials or query strings', () => {
    expect(normalizeArrUrl(' http://arr.local:8989/sonarr/ ')).toBe('http://arr.local:8989/sonarr');
    expect(() => normalizeArrUrl('http://admin:secret@arr.local')).toThrow(/without a username/);
    expect(() => normalizeArrUrl('http://arr.local?token=x')).toThrow(/without a username/);
    expect(() => normalizeArrUrl('file:///etc')).toThrow(/http:\/\//);
  });

  it('is admin-only, tests before saving, and never returns the API keys', async () => {
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await env.app.inject({ url: '/api/admin/arr', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'PUT', url: '/api/admin/arr/sonarr', headers: { cookie: viewer.cookie }, payload: { url: 'http://arr.local:8989/sonarr', apiKey: SONARR_KEY } })).statusCode).toBe(403);
    const wrong = await env.app.inject({ method: 'PUT', url: '/api/admin/arr/sonarr', headers: { cookie: admin }, payload: { url: 'http://arr.local:8989/sonarr', apiKey: RADARR_KEY } });
    expect(wrong.statusCode).toBe(502);
    expect((await env.app.inject({ url: '/api/admin/arr', headers: { cookie: admin } })).json().sonarr).toEqual({ url: '', hasKey: false });

    const saved = await env.app.inject({ method: 'PUT', url: '/api/admin/arr/sonarr', headers: { cookie: admin }, payload: { url: 'http://arr.local:8989/sonarr/', apiKey: SONARR_KEY } });
    expect(saved.json()).toEqual({ url: 'http://arr.local:8989/sonarr', hasKey: true, version: '4.0.0' });
    const shown = await env.app.inject({ url: '/api/admin/arr', headers: { cookie: admin } });
    expect(shown.json().sonarr).toEqual({ url: 'http://arr.local:8989/sonarr', hasKey: true });
    expect(shown.body).not.toContain(SONARR_KEY);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/sonarr/api/v3/system/status', key: RADARR_KEY });
  });

  it('lists sanitized series and movies and keeps their distinct API endpoints', async () => {
    await env.app.inject({ method: 'PUT', url: '/api/admin/arr/sonarr', headers: { cookie: admin }, payload: { url: 'http://arr.local:8989/sonarr', apiKey: SONARR_KEY } });
    await env.app.inject({ method: 'PUT', url: '/api/admin/arr/radarr', headers: { cookie: admin }, payload: { url: 'http://arr.local:8989/radarr', apiKey: RADARR_KEY } });
    const series = await env.app.inject({ url: '/api/admin/arr/sonarr/items', headers: { cookie: admin } });
    const movies = await env.app.inject({ url: '/api/admin/arr/radarr/items', headers: { cookie: admin } });
    expect(series.json().items).toEqual([{ id: 4, title: 'A Series', year: 2020, monitored: true, status: 'continuing' }]);
    expect(movies.json().items).toEqual([{ id: 8, title: 'A Movie', year: 2021, monitored: false, status: 'released' }]);
    expect(calls).toContainEqual({ method: 'GET', path: '/sonarr/api/v3/series', key: SONARR_KEY });
    expect(calls).toContainEqual({ method: 'GET', path: '/radarr/api/v3/movie', key: RADARR_KEY });
  });

  it('keeps files by default and only deletes them after an explicit option', async () => {
    await env.app.inject({ method: 'PUT', url: '/api/admin/arr/radarr', headers: { cookie: admin }, payload: { url: 'http://arr.local:8989/radarr', apiKey: RADARR_KEY } });
    const kept = await env.app.inject({ method: 'DELETE', url: '/api/admin/arr/radarr/items/8', headers: { cookie: admin } });
    const deleted = await env.app.inject({ method: 'DELETE', url: '/api/admin/arr/radarr/items/8?deleteFiles=true', headers: { cookie: admin } });
    expect(kept.statusCode).toBe(200);
    expect(deleted.statusCode).toBe(200);
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
      '/radarr/api/v3/movie/8?deleteFiles=false&addImportExclusion=false',
      '/radarr/api/v3/movie/8?deleteFiles=true&addImportExclusion=false',
    ]);
  });

  it('turns an integration off and refuses unconfigured list or delete calls', async () => {
    await env.app.inject({ method: 'PUT', url: '/api/admin/arr/sonarr', headers: { cookie: admin }, payload: { url: 'http://arr.local:8989/sonarr', apiKey: SONARR_KEY } });
    await env.app.inject({ method: 'PUT', url: '/api/admin/arr/sonarr', headers: { cookie: admin }, payload: { url: '' } });
    expect((await env.app.inject({ url: '/api/admin/arr/sonarr/items', headers: { cookie: admin } })).statusCode).toBe(409);
    expect((await env.app.inject({ method: 'DELETE', url: '/api/admin/arr/sonarr/items/4', headers: { cookie: admin } })).statusCode).toBe(409);
    expect((await env.app.inject({ url: '/api/admin/arr', headers: { cookie: admin } })).json().sonarr).toEqual({ url: '', hasKey: false });
  });
});