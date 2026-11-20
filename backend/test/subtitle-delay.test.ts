import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let fileId: number;
let option: { key: string; url: string; delay: number; delayUrl: string };

beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
  touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'));
  touch(path.join(env.mediaDir, 'movies', 'Heat (1995).en.srt'), '1\n00:00:05,000 --> 00:00:07,000\nHallo\n');
  await addLibrary(env, admin, 'movies', 'movies');
  const movie = (await get('/api/movies')).items[0];
  fileId = (await get(`/api/movies/${movie.id}`)).files[0].id;
  option = (await get(`/api/media/${fileId}/subtitles`)).find((o: { kind: string }) => o.kind === 'external');
});
afterEach(async () => {
  await env.cleanup();
});

async function get(url: string, cookie = admin) {
  return (await env.app.inject({ url, headers: { cookie } })).json();
}
function put(url: string, payload: unknown, cookie = admin) {
  return env.app.inject({ method: 'PUT', url, headers: { cookie }, payload: payload as object });
}
const vtt = async (url: string) => (await env.app.inject({ url, headers: { cookie: admin } })).body;

describe('the sync correction of a subtitle that came with the file', () => {
  it('is kept with the file for everyone, and applied for every player that does not shift it itself', async () => {
    expect(option).toMatchObject({ delay: 0, delayUrl: `/api/media/${fileId}/subtitles/${option.key}/delay` });
    // Anyone who can watch the file may correct it.
    const anna = await createUser(env.app, admin, 'anna');
    const saved = await put(option.delayUrl, { delay: -1.54 }, anna.cookie);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ delay: -1.5 });
    const listed = (await get(`/api/media/${fileId}/subtitles`, anna.cookie)).find((o: { key: string }) => o.key === option.key);
    expect(listed.delay).toBe(-1.5);
    // The TV gets the file with the correction in it, and not from a cache of an older one.
    const shifted = await env.app.inject({ url: option.url, headers: { cookie: admin } });
    expect(shifted.body).toContain('00:00:03.500 --> 00:00:05.500');
    expect(shifted.headers['cache-control']).toBe('private, no-cache');
    // Together with the start of a live stream.
    expect(await vtt(`${option.url}?offset=2`)).toContain('00:00:01.500 --> 00:00:03.500');
    // The website and the app shift it themselves, so they ask for the file as it is.
    expect(await vtt(`${option.url}?delay=0`)).toContain('00:00:05.000 --> 00:00:07.000');
    // Back to in sync forgets it.
    await put(option.delayUrl, { delay: 0 });
    expect((await get(`/api/media/${fileId}/subtitles`)).find((o: { key: string }) => o.key === option.key).delay).toBe(0);
    expect(await vtt(option.url)).toContain('00:00:05.000 --> 00:00:07.000');
  });

  it('checks who asks, the subtitle and the value', async () => {
    expect((await env.app.inject({ method: 'PUT', url: option.delayUrl, payload: { delay: 1 } })).statusCode).toBe(401);
    expect((await put(option.delayUrl, { delay: 601 })).statusCode).toBe(400);
    expect((await put(option.delayUrl, { delay: '1' })).statusCode).toBe(400);
    expect((await put(option.delayUrl, { delay: 1, other: true })).statusCode).toBe(400);
    // Only subtitles this file has.
    expect((await put(`/api/media/${fileId}/subtitles/ext-9999/delay`, { delay: 1 })).statusCode).toBe(404);
    expect((await put(`/api/media/${fileId}/subtitles/emb-0/delay`, { delay: 1 })).statusCode).toBe(404);
    expect((await put(`/api/media/${fileId}/subtitles/onl-1/delay`, { delay: 1 })).statusCode).toBe(404);
    expect((await put(`/api/media/9999/subtitles/${option.key}/delay`, { delay: 1 })).statusCode).toBe(404);
    expect((await env.app.inject({ url: `${option.url}?delay=abc`, headers: { cookie: admin } })).statusCode).toBe(400);
  });

  it('is not for someone who cannot see the library', async () => {
    const kid = await createUser(env.app, admin, 'kid');
    await env.app.inject({ method: 'PUT', url: `/api/users/${kid.id}`, headers: { cookie: admin }, payload: { libraryIds: [] } });
    const r = await put(option.delayUrl, { delay: 1 }, kid.cookie);
    expect([403, 404]).toContain(r.statusCode);
    expect((await get(`/api/media/${fileId}/subtitles`)).find((o: { key: string }) => o.key === option.key).delay).toBe(0);
  });
});
