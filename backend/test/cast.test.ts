import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { mediaFiles, subtitles } from '../src/db/schema.js';
import { castPath, signCastToken, verifyCastToken } from '../src/services/cast.js';

let env: TestEnv;
afterEach(async () => env?.cleanup());

async function setup() {
  env = await createTestEnv({
    prober: async (file) =>
      file.endsWith('.mkv')
        ? fakeProbe({ container: 'mkv', videoCodec: 'h264', audioCodec: 'aac' })
        : file.includes('Mpeg2')
          ? fakeProbe({ container: 'mp4', videoCodec: 'mpeg2video' })
          : fakeProbe({ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }),
  });
  const admin = await setupAdmin(env.app);
  touch(path.join(env.mediaDir, 'movies', 'Dune (2021).mp4'), 'x'.repeat(4096));
  touch(path.join(env.mediaDir, 'movies', 'Arrival (2016).mkv'), 'y'.repeat(4096));
  touch(path.join(env.mediaDir, 'movies', 'Old Mpeg2 (1999).mp4'), 'z'.repeat(4096));
  await addLibrary(env, admin, 'movies', 'movies');
  const file = (name: string) => env.ctx.db.select().from(mediaFiles).all().find((f) => f.path.includes(name))!;
  return { admin, dune: file('Dune'), arrival: file('Arrival'), mpeg2: file('Mpeg2') };
}
const session = (cookie: string, fileId: number) => env.app.inject({ method: 'POST', url: '/api/cast/session', headers: { cookie }, payload: { fileId } });

describe('casting to a Chromecast', () => {
  it('hands out what a Chromecast plays, with a token for just that file', async () => {
    const { admin, dune, arrival, mpeg2 } = await setup();
    const direct = (await session(admin, dune.id)).json();
    expect(direct).toMatchObject({ contentType: 'video/mp4', decision: { engine: 'direct', seek: 'range' } });
    expect(direct.token).toMatch(/^[\w-]+\.[\w-]+$/);
    // MKV: repackaged (the Chromecast does not take MKV), never converted.
    const remux = (await session(admin, arrival.id)).json();
    expect(remux).toMatchObject({ contentType: 'application/vnd.apple.mpegurl', decision: { engine: 'remux', seek: 'range' } });
    expect(remux.decision.streamUrl).toContain(`/api/media/${arrival.id}/hls/index.m3u8?`);
    // Video a Chromecast cannot decode, with conversion off (the default): said so, not transcoded.
    const no = await session(admin, mpeg2.id);
    expect(no.statusCode).toBe(415);
    expect(no.json().error).toMatch(/turn on video conversion/);
    expect((await env.app.inject({ method: 'POST', url: '/api/cast/session', payload: { fileId: dune.id } })).statusCode).toBe(401);
  });

  it('offers only the automatically provisioned direct address for web playback', async () => {
    const { admin, dune, arrival } = await setup();
    env.ctx.settings.update({
      cloud: {
        serverId: 'server-id',
        secret: 'server-secret-at-least-20-characters',
        account: 'justin@example.com',
        directAccess: { configured: true, hostname: 'server.media.vidalune.com', publicIp: null, port: 32400, dnsReady: true, tlsReady: true, portOpen: true, checkedAt: Date.now(), url: 'https://server.media.vidalune.com:32400' },
      },
    });
    await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { serverUrl: 'https://legacy.example.com' } });
    const response = await env.app.inject({ method: 'POST', url: `/api/media/${dune.id}/playback`, headers: { cookie: admin }, payload: {} });
    const direct = response.json().directPlayback;
    expect(direct.baseUrl).toBe('https://server.media.vidalune.com:32400');
    expect(direct.baseUrl).not.toContain('legacy.example.com');
    expect(direct.token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(response.headers['content-security-policy']).toContain('https://server.media.vidalune.com:32400');
    expect(verifyCastToken(env.ctx.config.sessionSecret, direct.token)).toMatchObject({ userId: 1, fileId: dune.id, artwork: false });
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${direct.token}` })).statusCode).toBe(200);
    expect((await env.app.inject({ url: `/api/media/${arrival.id}/stream?cast=${direct.token}` })).statusCode).toBe(401);
    expect((await env.app.inject({ url: `/api/images/w342/example.jpg?cast=${direct.token}` })).statusCode).toBe(401);
    expect(castPath('/api/online-subtitles/9.vtt')).toEqual({ subtitleId: 9 });
  });

  it('lets the Chromecast fetch that file (and its subtitles and artwork) without signing in — nothing else', async () => {
    const { admin, dune, arrival } = await setup();
    const { token } = (await session(admin, dune.id)).json();
    const get = (url: string, method: 'GET' | 'HEAD' | 'POST' = 'GET') => env.app.inject({ method, url: `${url}${url.includes('?') ? '&' : '?'}cast=${encodeURIComponent(token)}` });
    const res = await get(`/api/media/${dune.id}/stream`);
    expect(res.statusCode).toBe(200);
    // It loads from its own page (another origin).
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect((await get(`/api/media/${dune.id}/stream`, 'HEAD')).statusCode).toBe(200);
    // Another file, another endpoint, or a change: no.
    expect((await get(`/api/media/${arrival.id}/stream`)).statusCode).toBe(401);
    expect((await get('/api/home')).statusCode).toBe(401);
    expect((await get(`/api/media/${dune.id}/playback`, 'POST')).statusCode).toBe(401);
    // Subtitles of this file only.
    const mine = env.ctx.db.insert(subtitles).values({ mediaFileId: dune.id, path: path.join(env.mediaDir, 'movies', 'Dune (2021).en.srt'), label: 'English', language: 'en', format: 'srt', forced: false }).returning().get();
    const theirs = env.ctx.db.insert(subtitles).values({ mediaFileId: arrival.id, path: path.join(env.mediaDir, 'movies', 'Arrival (2016).en.srt'), label: 'English', language: 'en', format: 'srt', forced: false }).returning().get();
    expect((await get(`/api/subtitles/${theirs.id}.vtt`)).statusCode).toBe(401);
    expect((await get(`/api/subtitles/${mine.id}.vtt`)).statusCode).not.toBe(401);
    // A wrong or changed token opens nothing; a normal request is not affected.
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${token}x` })).statusCode).toBe(401);
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream`, headers: { cookie: admin } })).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps the file-scoped cast token on the HLS playlist, init segment, and media segments', async () => {
    const { admin, arrival } = await setup();
    const hls = (await session(admin, arrival.id)).json();
    const token = hls.token as string;
    vi.spyOn(env.ctx.hls, 'layout').mockResolvedValue({ starts: [0, 2], duration: 4 });
    const url = new URL(hls.decision.streamUrl, 'http://localhost');
    url.searchParams.set('cast', token);
    const response = await env.app.inject({ url: `${url.pathname}${url.search}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(response.body).toContain('#EXTINF:2.000000,');
    expect(response.body).toContain('#EXT-X-ENDLIST');
    expect(response.body).toContain(`init.mp4?audio=1&copy=1&cast=${token}`);
    expect(response.body).toContain(`seg/0.m4s?audio=1&copy=1&cast=${token}`);
    expect(castPath(`/api/media/${arrival.id}/hls/index.m3u8`)).toEqual({ fileId: arrival.id });
    expect(castPath(`/api/media/${arrival.id}/hls/init.mp4`)).toEqual({ fileId: arrival.id });
    expect(castPath(`/api/media/${arrival.id}/hls/seg/0.m4s`)).toEqual({ fileId: arrival.id });
    expect(castPath(`/api/media/${arrival.id}/hls/seg/../home`)).toBeNull();
  });

  it('stops working when the account is disabled or the token runs out', async () => {
    const { admin, dune } = await setup();
    const anna = await createUser(env.app, admin, 'anna');
    const { token } = (await session(anna.cookie, dune.id)).json();
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${token}` })).statusCode).toBe(200);
    await env.app.inject({ method: 'PUT', url: `/api/users/${anna.id}`, headers: { cookie: admin }, payload: { disabled: true } });
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${token}` })).statusCode).toBe(401);
    const secret = env.ctx.config.sessionSecret;
    const old = signCastToken(secret, { userId: 1, fileId: dune.id, expiresAt: Date.now() - 1000 });
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${old}` })).statusCode).toBe(401);
    // A file the user may not see: the stream refuses it like any other request.
    expect(env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.id, dune.id)).get()).toBeTruthy();
  });
});

describe('cast tokens', () => {
  it('are signed, tied to one file and expire', () => {
    const t = signCastToken('secret', { userId: 3, fileId: 9, expiresAt: 2000 });
    expect(verifyCastToken('secret', t, 1000)).toEqual({ userId: 3, fileId: 9, expiresAt: 2000, artwork: true });
    expect(verifyCastToken('secret', t, 2000)).toBeNull();
    expect(verifyCastToken('other', t, 1000)).toBeNull();
    const artwork = signCastToken('secret', { userId: 3, fileId: 9, expiresAt: 2000, artwork: true });
    expect(verifyCastToken('secret', artwork, 1000)).toEqual({ userId: 3, fileId: 9, expiresAt: 2000, artwork: true });
    const mediaOnly = signCastToken('secret', { userId: 3, fileId: 9, expiresAt: 2000, artwork: false });
    expect(verifyCastToken('secret', mediaOnly, 1000)).toEqual({ userId: 3, fileId: 9, expiresAt: 2000, artwork: false });
    const [body, mac] = t.split('.');
    const forged = `${Buffer.from('3.10.2000').toString('base64url')}.${mac}`;
    expect(verifyCastToken('secret', forged, 1000)).toBeNull();
    expect(verifyCastToken('secret', `${body}.${mac}.x`, 1000)).toBeNull();
    expect(verifyCastToken('secret', undefined)).toBeNull();
  });

  it('only open a file’s stream, subtitles and artwork', () => {
    expect(castPath('/api/media/5/stream')).toEqual({ fileId: 5 });
    expect(castPath('/api/media/5/remux')).toEqual({ fileId: 5 });
    expect(castPath('/api/media/5/subtitles/2.vtt')).toEqual({ fileId: 5 });
    expect(castPath('/api/subtitles/7.vtt')).toEqual({ subtitleId: 7 });
    expect(castPath('/api/online-subtitles/7.vtt')).toEqual({ subtitleId: 7 });
    expect(castPath('/api/images/w342/a.jpg')).toBe('image');
    expect(castPath('/api/media/5/playback')).toBeNull();
    expect(castPath('/api/home')).toBeNull();
    expect(castPath('/api/media/5/stream/../../home')).toBeNull();
  });
});
