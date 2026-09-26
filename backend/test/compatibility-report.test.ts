import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeProbe, addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv({
    prober: async (file) => {
      if (file.includes('hevc')) return fakeProbe({ container: 'mkv', videoCodec: 'hevc', videoBitDepth: 10, videoRange: 'HDR10', audioCodec: 'truehd' });
      if (file.includes('dts')) return fakeProbe({ container: 'mkv', audioCodec: 'dts' });
      if (file.includes('xvid')) return fakeProbe({ container: 'avi', videoCodec: 'mpeg4', audioCodec: 'mp3' });
      if (file.toLowerCase().includes('broken')) throw new Error('Invalid data found when processing input');
      return fakeProbe({ container: 'mp4' });
    },
  });
  admin = await setupAdmin(env.app);
});
afterEach(async () => {
  await env.cleanup();
});

describe('compatibility overview', () => {
  it('summarises each library from cached probe data', async () => {
    for (const name of ['Plain (2001).mp4', 'Big hevc (2020).mkv', 'Loud dts (2010).mkv', 'Old xvid (1999).avi', 'Broken (2005).mkv']) touch(path.join(env.mediaDir, 'movies', name));
    await addLibrary(env, admin, 'movies', 'movies');
    const res = await env.app.inject({ url: '/api/admin/compatibility', headers: { cookie: admin } });
    const [lib] = res.json().libraries;
    expect(lib).toMatchObject({ name: 'movies', files: 5, verdicts: { direct: 1, remux: 1, 'browser-dependent': 1, incompatible: 1, unknown: 1 }, health: { probeErrors: 1 } });
    const labels = lib.issues.map((i: { label: string }) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['HEVC video', '10-bit video', 'HDR', 'Dolby TrueHD audio', 'DTS audio', 'MPEG-4 Part 2 (DivX/Xvid) video', 'AVI container']));
  });

  it('analyses files from older versions on request, then reports them', async () => {
    touch(path.join(env.mediaDir, 'movies', 'Big hevc (2020).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    env.ctx.db.$client.prepare('UPDATE media_files SET video_bit_depth = NULL, video_range = NULL').run();
    let r = (await env.app.inject({ url: '/api/admin/compatibility', headers: { cookie: admin } })).json();
    expect(r.libraries[0].notAnalyzed).toBe(1);
    await env.app.inject({ method: 'POST', url: '/api/admin/compatibility/analyze', headers: { cookie: admin } });
    for (let i = 0; i < 50 && env.ctx.analyzer.status().running; i++) await new Promise((res) => setTimeout(res, 10));
    r = (await env.app.inject({ url: '/api/admin/compatibility', headers: { cookie: admin } })).json();
    expect(r.libraries[0].notAnalyzed).toBe(0);
    expect(r.analysis).toMatchObject({ running: false, done: 1, total: 1, failed: 0 });
  });

  it('is admin-only', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    expect((await env.app.inject({ url: '/api/admin/compatibility', headers: { cookie: user.cookie } })).statusCode).toBe(403);
  });
});
