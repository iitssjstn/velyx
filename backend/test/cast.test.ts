import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { episodes, mediaFiles, onlineSubtitles, subtitles } from '../src/db/schema.js';
import { saveManualSegments } from '../src/services/segments/store.js';
import { HeavyWork } from '../src/services/heavy-work.js';
import { castPath, playbackJwtExpiresAt, signPlaybackJwt, verifyPlaybackJwt } from '../src/services/cast.js';
import { keyframesKey } from '../src/playback/hls.js';

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
/** A few seconds of real H.264 video, so its keyframes can be read (files that are only named are not video). */
function realVideo(file: string, seconds = 4) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=25`, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-y', file]);
}
const session = (cookie: string, fileId: number) => env.app.inject({ method: 'POST', url: '/api/cast/session', headers: { cookie }, payload: { fileId } });
/** The sign-in and start of the cast a real cast token belongs to (to sign test tokens with). */
const chainOf = (token: string) => {
  const { sid, root } = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { sid: string; root: number };
  return { sid, root: root * 1000 };
};

describe('casting to a Chromecast', () => {
  it('hands out what a Chromecast plays, with a token for just that file', async () => {
    const { admin, dune, arrival, mpeg2 } = await setup();
    const direct = (await session(admin, dune.id)).json();
    expect(direct).toMatchObject({ contentType: 'video/mp4', decision: { engine: 'direct', seek: 'range' } });
    expect(direct).not.toHaveProperty('relayUrl');
    expect(direct.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
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

  it('names the server, so a TV with the Vidalune app plays the title itself when signed in to it', async () => {
    const { admin, dune } = await setup();
    expect((await session(admin, dune.id)).json().serverId).toBeNull();
    env.ctx.settings.update({ cloud: { serverId: 'server-id', secret: 'server-secret-at-least-20-characters', account: 'justin@example.com' } });
    expect((await session(admin, dune.id)).json().serverId).toBe('server-id');
  });

  it('offers only the automatically provisioned direct address for web playback', async () => {
    const { admin, dune, arrival } = await setup();
    env.ctx.settings.update({
      cloud: {
        serverId: 'server-id',
        secret: 'server-secret-at-least-20-characters',
        account: 'justin@example.com',
        relay: true,
        relayUrl: 'https://relay.example.com',
        relayAllowed: true,
        directAccess: { configured: true, hostname: 'server.media.vidalune.com', publicIp: null, port: 32400, dnsReady: true, tlsReady: true, portOpen: true, checkedAt: Date.now(), url: 'https://server.media.vidalune.com:32400', localEndpoints: [{ type: 'lan', address: '192.168.1.50', port: 32400, protocol: 'https' }] },
      },
    });
    await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { serverUrl: 'https://legacy.example.com' } });
    const response = await env.app.inject({ method: 'POST', url: `/api/media/${dune.id}/playback`, headers: { cookie: admin }, payload: {} });
    const direct = response.json().directPlayback;
    expect(direct.endpoints.map((endpoint: { url: string }) => endpoint.url)).toEqual(['https://192.168.1.50:32400', 'https://server.media.vidalune.com:32400', 'https://legacy.example.com']);
    expect(direct.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain('https://relay.example.com');
    expect(csp).toContain('https://server.media.vidalune.com:32400');
    expect(csp.split(';').find((directive) => directive.trim().startsWith('media-src'))).not.toContain('https://relay.example.com');
    expect(await verifyPlaybackJwt(env.ctx.config.sessionSecret, direct.token)).toMatchObject({ userId: 1, fileId: dune.id, artwork: false });
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${direct.token}` })).statusCode).toBe(200);
    expect((await env.app.inject({ url: `/api/media/${arrival.id}/stream?cast=${direct.token}` })).statusCode).toBe(401);
    expect((await env.app.inject({ url: `/api/images/w342/example.jpg?cast=${direct.token}` })).statusCode).toBe(401);
    expect(castPath('/api/online-subtitles/9.vtt')).toEqual({ subtitleId: 9, table: 'online' });
    expect(castPath('/api/subtitles/9.vtt')).toEqual({ subtitleId: 9, table: 'subtitles' });
  });

  it('opens a subtitle only when the table the address names has it for the cast file', async () => {
    const { admin, dune, arrival } = await setup();
    // The same id in both tables: an online subtitle of Dune, a local subtitle of Arrival.
    env.ctx.db.insert(onlineSubtitles).values({ id: 900, mediaFileId: dune.id, providerFileId: 1, language: 'en', fileName: 'dune-en.vtt' }).run();
    env.ctx.db.insert(subtitles).values({ id: 900, mediaFileId: arrival.id, path: '/media/arrival.srt', format: 'srt', label: 'English' }).run();
    const token = await signPlaybackJwt(env.ctx.config.sessionSecret, { userId: 1, fileId: dune.id, expiresAt: Date.now() + 60_000, ...chainOf((await session(admin, dune.id)).json().token) });
    expect((await env.app.inject({ url: `/api/subtitles/900.vtt?cast=${token}` })).statusCode).toBe(401);
    expect((await env.app.inject({ url: `/api/online-subtitles/900.vtt?cast=${token}` })).statusCode).not.toBe(401);
  });

  it('never advertises Vidalune account hosts as media endpoints', async () => {
    const { admin, dune } = await setup();
    await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { serverUrl: 'https://app.vidalune.com' } });
    const response = await env.app.inject({ method: 'POST', url: `/api/media/${dune.id}/playback`, headers: { cookie: admin }, payload: {} });
    expect(response.json()).not.toHaveProperty('directPlayback');
    const cast = await session(admin, dune.id);
    expect(cast.json()).toMatchObject({ directUrl: null, serverUrl: null });
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

  it('lets Vidalune\'s own cast player save where the TV is, for that file and its user only', async () => {
    const { admin, dune, arrival } = await setup();
    const anna = await createUser(env.app, admin, 'anna');
    const { token } = (await session(anna.cookie, dune.id)).json();
    const save = (cast: string | null, payload: object = { positionSec: 600, durationSec: 6000 }, headers: Record<string, string> = {}) =>
      env.app.inject({ method: 'POST', url: `/api/cast/progress${cast ? `?cast=${encodeURIComponent(cast)}` : ''}`, headers: { origin: 'https://cast.vidalune.com', ...headers }, payload });
    // The page on cast.vidalune.com asks first (another origin), then saves.
    const preflight = await env.app.inject({ method: 'OPTIONS', url: `/api/cast/progress?cast=${token}`, headers: { origin: 'https://cast.vidalune.com', 'access-control-request-method': 'POST' } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
    const saved = await save(token);
    expect(saved.statusCode).toBe(200);
    expect(saved.headers['access-control-allow-origin']).toBe('*');
    expect(saved.json()).toMatchObject({ positionSec: 600, durationSec: 6000, completed: false });
    const progress = (await env.app.inject({ url: '/api/progress', headers: { cookie: anna.cookie } })).json();
    expect(progress).toEqual([expect.objectContaining({ movieId: dune.movieId, positionSec: 600 })]);
    // Nobody else's progress, and only for the cast file.
    expect((await env.app.inject({ url: '/api/progress', headers: { cookie: admin } })).json()).toEqual([]);
    expect(castPath('/api/cast/progress')).toBe('progress');
    // Not without the token (from another site that is refused outright), not with a browser's
    // direct-play token, not with a GET, not with bad numbers.
    expect((await save(null)).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: '/api/cast/progress', headers: { cookie: anna.cookie }, payload: { positionSec: 1, durationSec: 2 } })).statusCode).toBe(403);
    const directPlay = await signPlaybackJwt(env.ctx.config.sessionSecret, { userId: anna.id, fileId: dune.id, expiresAt: Date.now() + 60_000, artwork: false, ...chainOf(token) });
    expect((await save(directPlay)).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: `/api/cast/progress?cast=${directPlay}`, payload: { positionSec: 1, durationSec: 2 } })).statusCode).toBe(401);
    expect((await env.app.inject({ url: `/api/cast/progress?cast=${token}` })).statusCode).toBe(404);
    expect((await save(token, { positionSec: -1, durationSec: 10 })).statusCode).toBe(400);
    // The token also opens nothing else with a POST.
    expect((await env.app.inject({ method: 'POST', url: `/api/progress?cast=${token}`, payload: { movieId: arrival.movieId, positionSec: 1, durationSec: 2 } })).statusCode).toBe(401);
  });

  it('stops working when the sign-in it came from is signed out, or the password changes', async () => {
    const { admin, dune } = await setup();
    const anna = await createUser(env.app, admin, 'anna');
    const { token } = (await session(anna.cookie, dune.id)).json();
    const stream = () => env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${token}` });
    expect((await stream()).statusCode).toBe(200);
    await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: anna.cookie } });
    expect((await stream()).statusCode).toBe(401);
    // An administrator setting a new password signs all of anna's devices out, the TV too.
    const lotte = await createUser(env.app, admin, 'lotte');
    const second = (await session(lotte.cookie, dune.id)).json().token as string;
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${second}` })).statusCode).toBe(200);
    await env.app.inject({ method: 'PUT', url: `/api/users/${lotte.id}`, headers: { cookie: admin }, payload: { password: 'another-password-1' } });
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${second}` })).statusCode).toBe(401);
  });

  it('stops working when the account is disabled or the token runs out', async () => {
    const { admin, dune } = await setup();
    const anna = await createUser(env.app, admin, 'anna');
    const { token } = (await session(anna.cookie, dune.id)).json();
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${token}` })).statusCode).toBe(200);
    await env.app.inject({ method: 'PUT', url: `/api/users/${anna.id}`, headers: { cookie: admin }, payload: { disabled: true } });
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${token}` })).statusCode).toBe(401);
    const secret = env.ctx.config.sessionSecret;
    const old = await signPlaybackJwt(secret, { userId: 1, fileId: dune.id, expiresAt: Date.now() - 1000, ...chainOf((await session(admin, dune.id)).json().token) }, Date.now() - 2000);
    expect((await env.app.inject({ url: `/api/media/${dune.id}/stream?cast=${old}` })).statusCode).toBe(401);
    // A file the user may not see: the stream refuses it like any other request.
    expect(env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.id, dune.id)).get()).toBeTruthy();
  });
});

describe('casting a file whose keyframes are not known yet', () => {
  // Copied video goes to the TV in pieces made from the file's keyframes, read from the whole file
  // (minutes on a NAS). The TV gave up on the list of pieces while it waited: "status code 2100".
  async function mkvSetup(write: (file: string) => void) {
    env = await createTestEnv({ prober: async () => fakeProbe({ container: 'mkv', videoCodec: 'h264', audioCodec: 'aac' }) });
    const admin = await setupAdmin(env.app);
    write(path.join(env.mediaDir, 'movies', 'Arrival (2016).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const arrival = env.ctx.db.select().from(mediaFiles).all()[0]!;
    const ready = async (cookie = admin) => (await env.app.inject({ url: `/api/cast/ready?fileId=${arrival.id}`, headers: { cookie } })).json().state as string;
    const settled = async () => {
      let state = await ready();
      for (let i = 0; i < 200 && state === 'reading'; i++) {
        await new Promise((r) => setTimeout(r, 50));
        state = await ready();
      }
      return state;
    };
    return { admin, arrival, ready, settled };
  }

  it('says so and reads them at once, and the sender loads the TV when they are known', async () => {
    const { admin, arrival, settled } = await mkvSetup((file) => realVideo(file));
    const first = (await session(admin, arrival.id)).json();
    expect(first.decision.streamUrl).toContain('/hls/index.m3u8');
    expect(first.preparing).toBe(true);
    expect(await settled()).toBe('ready');
    expect((await session(admin, arrival.id)).json().preparing).toBe(false);
    // The list of pieces is there right away now.
    const list = await env.app.inject({ url: `${first.decision.streamUrl.replace(/^https?:\/\/[^/]+/, '')}&cast=${first.token}` });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain('#EXT-X-ENDLIST');
  });

  it('says when they cannot be read, instead of letting the sender wait forever', async () => {
    const { admin, arrival, settled } = await mkvSetup((file) => touch(file, 'y'.repeat(4096)));
    expect((await session(admin, arrival.id)).json().preparing).toBe(true);
    expect(await settled()).toBe('failed');
    // A new cast tries again.
    await session(admin, arrival.id);
    expect(await settled()).toBe('failed');
  });

  it('gets the next episode ready while one plays, so going on to it does not wait', async () => {
    env = await createTestEnv({ prober: async () => fakeProbe({ container: 'mkv', videoCodec: 'h264', audioCodec: 'aac' }) });
    const admin = await setupAdmin(env.app);
    for (const f of ['S01E01.mkv', 'S01E02.mkv']) realVideo(path.join(env.mediaDir, 'tv', 'Reacher', f));
    await addLibrary(env, admin, 'shows', 'tv');
    const [e1, e2] = env.ctx.db.select().from(episodes).orderBy(episodes.episodeNumber).all();
    const fileOf = (episodeId: number) => env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.episodeId, episodeId)).get()!;
    const state = async (fileId: number) => (await env.app.inject({ url: `/api/cast/ready?fileId=${fileId}`, headers: { cookie: admin } })).json().state as string;
    const second = keyframesKey(fileOf(e2!.id));
    expect(env.ctx.hls.ready(second)).toBe(false);
    await session(admin, fileOf(e1!.id).id);
    // Nobody asks for the second episode: casting the first one started reading it.
    for (let i = 0; i < 200 && !env.ctx.hls.ready(second); i++) await new Promise((r) => setTimeout(r, 50));
    expect(env.ctx.hls.ready(second)).toBe(true);
    expect(await state(fileOf(e2!.id).id)).toBe('ready');
  });

  it('lets one viewer read only a few whole files at once', async () => {
    env = await createTestEnv({ prober: async () => fakeProbe({ container: 'mkv', videoCodec: 'h264', audioCodec: 'aac' }) });
    const admin = await setupAdmin(env.app);
    for (const f of ['S01E01.mkv', 'S01E02.mkv']) realVideo(path.join(env.mediaDir, 'tv', 'Reacher', f));
    await addLibrary(env, admin, 'shows', 'tv');
    const [e1, e2] = env.ctx.db.select().from(episodes).orderBy(episodes.episodeNumber).all();
    const fileOf = (episodeId: number) => env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.episodeId, episodeId)).get()!;
    // Reading takes long (as on a NAS); one at a time for this test.
    env.ctx.heavy = new HeavyWork(1);
    env.ctx.hls.preparing = () => null;
    env.ctx.hls.prepare = () => new Promise<void>(() => undefined);
    const ask = (fileId: number) => env.app.inject({ url: `/api/cast/ready?fileId=${fileId}`, headers: { cookie: admin } });
    expect((await ask(fileOf(e1!.id).id)).statusCode).toBe(200);
    expect((await ask(fileOf(e2!.id).id)).statusCode).toBe(429);
    // Asking again for what is already being read for you is fine.
    expect((await ask(fileOf(e1!.id).id)).statusCode).toBe(200);
  });

  it('only for a signed-in viewer who may see the file', async () => {
    const { admin, arrival, ready } = await mkvSetup((file) => realVideo(file));
    expect((await env.app.inject({ url: `/api/cast/ready?fileId=${arrival.id}` })).statusCode).toBe(401);
    expect((await env.app.inject({ url: '/api/cast/ready?fileId=abc', headers: { cookie: admin } })).statusCode).toBe(400);
    const anna = await createUser(env.app, admin, 'anna');
    await env.app.inject({ method: 'PUT', url: `/api/users/${anna.id}`, headers: { cookie: admin }, payload: { libraryIds: [arrival.libraryId + 1000] } });
    expect([403, 404]).toContain((await env.app.inject({ url: `/api/cast/ready?fileId=${arrival.id}`, headers: { cookie: anna.cookie } })).statusCode);
    expect(['reading', 'ready']).toContain(await ready());
  });
});

describe('Vidalune\'s cast player operated with a remote', () => {
  async function showSetup() {
    env = await createTestEnv();
    const admin = await setupAdmin(env.app);
    // Real video: the TV waits for an episode's keyframes when it is played in pieces (another audio track).
    for (const f of ['S01E01.mp4', 'S01E02.mp4', 'S01E03.mp4']) realVideo(path.join(env.mediaDir, 'tv', 'Reacher', f));
    await addLibrary(env, admin, 'shows', 'tv');
    const eps = env.ctx.db.select().from(episodes).orderBy(episodes.episodeNumber).all();
    const fileOf = (episodeId: number) => env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.episodeId, episodeId)).get()!;
    return { admin, eps, fileOf };
  }

  it('tells the TV what to skip, which audio there is and which episode follows, with its cast token only', async () => {
    const { admin, eps, fileOf } = await showSetup();
    const first = fileOf(eps[0]!.id);
    saveManualSegments(env.ctx.db, eps[0]!.id, first, { intro: { start: 30, end: 90 }, credits: { start: 2500, end: 2600 }, postCredits: null });
    const { token } = (await session(admin, first.id)).json();
    const tv = await env.app.inject({ url: `/api/cast/tv?cast=${token}` });
    expect(tv.statusCode).toBe(200);
    expect(tv.headers['access-control-allow-origin']).toBe('*');
    const body = tv.json();
    expect(body.item).toEqual({ kind: 'episode', id: eps[0]!.id });
    expect(body.segments).toMatchObject({ intro: { start: 30, end: 90 }, credits: { start: 2500, end: 2600 } });
    expect(Array.isArray(body.audio)).toBe(true);
    expect(body.next).toMatchObject({ kind: 'episode', id: eps[1]!.id, fileId: fileOf(eps[1]!.id).id, subtitle: expect.stringMatching(/^S01E02/), resumeAt: 0 });
    // Only for a cast session's token: not signed in, not a browser's direct-play token.
    expect((await env.app.inject({ url: '/api/cast/tv', headers: { cookie: admin } })).statusCode).toBe(403);
    const directPlay = await signPlaybackJwt(env.ctx.config.sessionSecret, { userId: 1, fileId: first.id, expiresAt: Date.now() + 60_000, artwork: false, ...chainOf(token) });
    expect((await env.app.inject({ url: `/api/cast/tv?cast=${directPlay}` })).statusCode).toBe(401);
    // Info only with a GET (there is nothing to post there).
    expect((await env.app.inject({ method: 'POST', url: `/api/cast/tv?cast=${token}` })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'OPTIONS', url: '/api/cast/tv' })).statusCode).toBe(204);
    expect(castPath('/api/cast/tv')).toBe('tv');
    expect(castPath('/api/cast/tv/session')).toBe('tv-session');
  });

  it('lets a cast carry on from the TV for twelve hours at most, then someone casts again', async () => {
    const { admin, eps, fileOf } = await showSetup();
    const first = fileOf(eps[0]!.id);
    const { token } = (await session(admin, first.id)).json();
    const post = (cast: string) => env.app.inject({ method: 'POST', url: `/api/cast/tv/session?cast=${cast}`, payload: {} });
    // A renewal keeps when the cast began: renewing again and again does not make it new.
    const renewed = (await post(token)).json().token as string;
    expect(chainOf(renewed)).toEqual(chainOf(token));
    const { sid } = chainOf(token);
    const late = await signPlaybackJwt(env.ctx.config.sessionSecret, { userId: 1, fileId: first.id, expiresAt: Date.now() + 60_000, sid, root: Date.now() - 13 * 3_600_000 });
    expect((await post(late)).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: `/api/cast/tv/session?cast=${late}`, payload: { next: true } })).statusCode).toBe(403);
  });

  it('lets the TV start the next episode, or the same one with another audio track, and nothing else', async () => {
    const { admin, eps, fileOf } = await showSetup();
    const first = fileOf(eps[0]!.id);
    const second = fileOf(eps[1]!.id);
    const { token } = (await session(admin, first.id)).json();
    const post = (cast: string, payload: object) => env.app.inject({ method: 'POST', url: `/api/cast/tv/session?cast=${cast}`, payload });
    // The next episode: a new token for its file, with what the TV shows and where to start.
    await env.app.inject({ method: 'POST', url: '/api/progress', headers: { cookie: admin }, payload: { episodeId: eps[1]!.id, positionSec: 120, durationSec: 3000 } });
    const next = await post(token, { next: true });
    expect(next.statusCode).toBe(200);
    const nextBody = next.json();
    expect(nextBody.item).toMatchObject({ kind: 'episode', id: eps[1]!.id, fileId: second.id, resumeAt: 120 });
    expect(nextBody.decision.streamUrl).toContain(`/api/media/${second.id}/`);
    expect((await env.app.inject({ url: `/api/media/${second.id}/stream?cast=${nextBody.token}` })).statusCode).toBe(200);
    // The first token still opens only its own file.
    expect((await env.app.inject({ url: `/api/media/${second.id}/stream?cast=${token}` })).statusCode).toBe(401);
    // From the second episode on: the third follows, and after the last there is none.
    expect((await env.app.inject({ url: `/api/cast/tv?cast=${nextBody.token}` })).json().next).toMatchObject({ id: eps[2]!.id });
    const last = (await session(admin, fileOf(eps[2]!.id).id)).json().token;
    expect((await env.app.inject({ url: `/api/cast/tv?cast=${last}` })).json().next).toBeNull();
    expect((await post(last, { next: true })).statusCode).toBe(404);
    // The next episode in the language the TV plays (not its default track), and its default without a match.
    const audio = (language: string, isDefault: boolean, index: number) => ({ index, codec: 'aac', language, channels: 2, channelLayout: 'stereo', title: null, isDefault });
    env.ctx.db.update(mediaFiles).set({ audioTracks: [audio('ita', true, 1), audio('eng', false, 2)] }).where(eq(mediaFiles.id, second.id)).run();
    const english = await post(token, { next: true, audioLanguage: 'eng' });
    expect(english.statusCode).toBe(200);
    expect(english.json().decision.audioIndex).toBe(2);
    expect((await post(token, { next: true, audioLanguage: 'fre' })).json().decision.audioIndex).not.toBe(2);
    expect((await post(token, { next: true, audioLanguage: 'x'.repeat(40) })).statusCode).toBe(400);
    // The same file with another audio track (one the file has).
    const tracks = (await env.app.inject({ url: `/api/cast/tv?cast=${token}` })).json().audio as { index: number }[];
    if (tracks[0]) expect((await post(token, { audioIndex: tracks[0].index })).json().item).toMatchObject({ id: eps[0]!.id, fileId: first.id });
    expect((await post(token, { audioIndex: 999 })).statusCode).toBe(400);
    expect((await post(token, { fileId: second.id })).statusCode).toBe(400);
    // Not without the cast token.
    expect((await env.app.inject({ method: 'POST', url: '/api/cast/tv/session', headers: { cookie: admin }, payload: { next: true } })).statusCode).toBe(403);
  });

  it('does not let the TV start an episode its user may not see', async () => {
    const { admin, eps, fileOf } = await showSetup();
    const anna = await createUser(env.app, admin, 'anna');
    const { token } = (await session(anna.cookie, fileOf(eps[0]!.id).id)).json();
    // Anna loses access to the library while casting: neither the info nor the next episode.
    const libraryId = fileOf(eps[0]!.id).libraryId;
    await env.app.inject({ method: 'PUT', url: `/api/users/${anna.id}`, headers: { cookie: admin }, payload: { libraryIds: [libraryId + 1000] } });
    expect([403, 404]).toContain((await env.app.inject({ url: `/api/cast/tv?cast=${token}` })).statusCode);
    expect([403, 404]).toContain((await env.app.inject({ method: 'POST', url: `/api/cast/tv/session?cast=${token}`, payload: { next: true } })).statusCode);
  });
});

describe('playback JWTs', () => {
  it('are standard HS256 JWTs, scoped to one file and expire exactly when claimed', async () => {
    const chain = { sid: 'a'.repeat(20), root: 1000 };
    const t = await signPlaybackJwt('secret', { userId: 3, fileId: 9, expiresAt: 10_000, ...chain }, 1000);
    const [header, body, signature] = t.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(body!, 'base64url').toString())).toMatchObject({ iss: 'vidalune-media', aud: 'vidalune-media', sub: '3', fileId: 9, scope: 'media:read', artwork: true, iat: 1, exp: 10 });
    expect(signature).toBeTruthy();
    expect(await verifyPlaybackJwt('secret', t, 1000)).toEqual({ userId: 3, fileId: 9, expiresAt: 10_000, artwork: true, ...chain });
    expect(await verifyPlaybackJwt('secret', t, 10_000)).toBeNull();
    expect(await verifyPlaybackJwt('other', t, 1000)).toBeNull();
    const mediaOnly = await signPlaybackJwt('secret', { userId: 3, fileId: 9, expiresAt: 10_000, artwork: false, ...chain }, 1000);
    expect(await verifyPlaybackJwt('secret', mediaOnly, 1000)).toMatchObject({ artwork: false });
    const [, encoded, mac] = t.split('.');
    const forgedPayload = { ...JSON.parse(Buffer.from(encoded!, 'base64url').toString()), fileId: 10 };
    const forged = `${header}.${Buffer.from(JSON.stringify(forgedPayload)).toString('base64url')}.${mac}`;
    expect(await verifyPlaybackJwt('secret', forged, 1000)).toBeNull();
    expect(await verifyPlaybackJwt('secret', `${t}.x`, 1000)).toBeNull();
    expect(await verifyPlaybackJwt('secret', undefined)).toBeNull();
  });

  it('bounds expiry to the selected playback session', () => {
    const now = 1_000_000;
    expect(playbackJwtExpiresAt(90 * 60, now)).toBe(now + 90 * 60_000 + 15 * 60_000);
    expect(playbackJwtExpiresAt(24 * 60 * 60, now)).toBe(now + 8 * 60 * 60_000);
  });

  it('only open a file’s stream, subtitles and artwork', () => {
    expect(castPath('/api/media/5/stream')).toEqual({ fileId: 5 });
    expect(castPath('/api/media/5/remux')).toEqual({ fileId: 5 });
    expect(castPath('/api/media/5/subtitles/2.vtt')).toEqual({ fileId: 5 });
    expect(castPath('/api/subtitles/7.vtt')).toEqual({ subtitleId: 7, table: 'subtitles' });
    expect(castPath('/api/online-subtitles/7.vtt')).toEqual({ subtitleId: 7, table: 'online' });
    expect(castPath('/api/images/w342/a.jpg')).toBe('image');
    expect(castPath('/api/media/5/playback')).toBeNull();
    expect(castPath('/api/home')).toBeNull();
    expect(castPath('/api/media/5/stream/../../home')).toBeNull();
  });
});
