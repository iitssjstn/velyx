import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { mediaFiles, movies } from '../src/db/schema.js';
import { betterVersion } from '../src/services/cleanup.js';

const GB = 1024 ** 3;

describe('betterVersion', () => {
  const v = (height: number | null, videoRange: string | null, size: number, probeError: string | null = null) => ({ height, videoRange, size, probeError });
  it('prefers resolution, then HDR, then the larger file; an unreadable file never wins', () => {
    expect(betterVersion(v(1080, 'SDR', 24 * GB), v(2160, 'SDR', 8 * GB)).height).toBe(2160);
    expect(betterVersion(v(1080, 'SDR', 24 * GB), v(1080, 'HDR10', 8 * GB)).videoRange).toBe('HDR10');
    expect(betterVersion(v(1080, 'HDR10', 9 * GB), v(1080, 'DV', 8 * GB)).videoRange).toBe('DV');
    expect(betterVersion(v(1080, 'SDR', 8 * GB), v(1080, 'SDR', 24 * GB)).size).toBe(24 * GB);
    expect(betterVersion(v(2160, 'HDR10', 50 * GB, 'broken'), v(720, 'SDR', GB)).height).toBe(720);
  });
});

describe('possible duplicates in the clean-up list', () => {
  let env: TestEnv;
  let admin: string;
  beforeEach(async () => {
    env = await createTestEnv({
      prober: async (file) => fakeProbe({ height: /2160p/.test(file) ? 2160 : 1080, width: /2160p/.test(file) ? 3840 : 1920, videoCodec: /x265|2160p/.test(file) ? 'hevc' : 'h264', videoRange: /HDR/.test(file) ? 'HDR10' : 'SDR', videoBitDepth: /HDR/.test(file) ? 10 : 8 }),
    });
    admin = await setupAdmin(env.app);
  });
  afterEach(() => env.cleanup());

  const list = async () => (await env.app.inject({ url: '/api/admin/cleanup', headers: { cookie: admin } })).json();

  it('shows every version side by side, and suggests the lesser one', async () => {
    touch(path.join(env.mediaDir, 'films', 'Heat (1995)', 'Heat.1995.1080p.WEB.mkv'), 'a');
    touch(path.join(env.mediaDir, 'films', 'Heat (1995)', 'Heat.1995.1080p.Remux.mkv'), 'b');
    await addLibrary(env, admin, 'movies', 'films');
    const db = env.ctx.db;
    for (const f of db.select().from(mediaFiles).all()) db.update(mediaFiles).set({ size: (f.path.includes('Remux') ? 24.8 : 8.2) * GB }).where(eq(mediaFiles.id, f.id)).run();
    const dupes = (await list()).items.filter((c: { reasons: { rule: string }[] }) => c.reasons.some((r) => r.rule === 'duplicates'));
    expect(dupes).toHaveLength(1);
    expect(dupes[0].path).toContain('WEB');
    expect(dupes[0].format).toBe('H.264 · 1080p · AAC 5.1 · MKV');
    expect(dupes[0].versions).toEqual([
      { fileId: expect.any(Number), name: 'Heat.1995.1080p.Remux.mkv', format: 'H.264 · 1080p · AAC 5.1 · MKV', size: 24.8 * GB, keep: true },
      { fileId: dupes[0].fileId, name: 'Heat.1995.1080p.WEB.mkv', format: 'H.264 · 1080p · AAC 5.1 · MKV', size: 8.2 * GB, keep: false },
    ]);
    expect(dupes[0].reasons.find((r: { rule: string }) => r.rule === 'duplicates').text).toBe('Another version exists: H.264 · 1080p · AAC 5.1 · MKV, 24.8 GB, Heat.1995.1080p.Remux.mkv');
  });

  it('recognises the same movie in two libraries by its TMDB entry', async () => {
    touch(path.join(env.mediaDir, 'films', 'Dune (2021).mkv'), 'a');
    touch(path.join(env.mediaDir, '4k', 'Dune Part One (2021) 2160p HDR.mkv'), 'b');
    await addLibrary(env, admin, 'movies', 'films');
    await addLibrary(env, admin, 'movies', '4k');
    // Both matched to the same TMDB movie (different names on disk).
    env.ctx.db.update(movies).set({ tmdbId: 438631 }).run();
    const items = (await list()).items;
    const dupes = items.filter((c: { reasons: { rule: string }[] }) => c.reasons.some((r) => r.rule === 'duplicates'));
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ library: 'films', versions: [expect.objectContaining({ keep: true, format: 'HEVC · 2160p · 10-bit · HDR10 · AAC 5.1 · MKV' }), expect.objectContaining({ keep: false })] });
  });
});
