import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isInside, resolveMediaPath, validateLibraryPath } from '../src/services/paths.js';
import { isValidImageRequest } from '../src/services/images.js';
import { addLibrary, createTestEnv, setupAdmin, touch, type TestEnv } from './helpers.js';

describe('path helpers', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-paths-'));
    fs.mkdirSync(path.join(tmp, 'media', 'movies'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'secret'));
    fs.writeFileSync(path.join(tmp, 'secret', 'passwd'), 'root:x');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('isInside handles prefixes and traversal', () => {
    expect(isInside('/media', '/media/movies/a.mkv')).toBe(true);
    expect(isInside('/media', '/media')).toBe(true);
    expect(isInside('/media', '/media2/a.mkv')).toBe(false);
    expect(isInside('/media', '/media/../etc/passwd')).toBe(false);
  });

  it('validateLibraryPath only accepts existing folders inside MEDIA_ROOTS', () => {
    const roots = [path.join(tmp, 'media')];
    expect(validateLibraryPath(path.join(tmp, 'media', 'movies'), roots).ok).toBe(true);
    expect(validateLibraryPath(path.join(tmp, 'secret'), roots).ok).toBe(false);
    expect(validateLibraryPath(path.join(tmp, 'media', 'nope'), roots).ok).toBe(false);
    expect(validateLibraryPath('media/movies', roots).ok).toBe(false);
    expect(validateLibraryPath(path.join(tmp, 'media', '..', 'secret'), roots).ok).toBe(false);
    expect(validateLibraryPath(path.join(tmp, 'media', 'movies\0'), roots).ok).toBe(false);
  });

  it('validateLibraryPath rejects symlinks that point outside MEDIA_ROOTS', () => {
    fs.symlinkSync(path.join(tmp, 'secret'), path.join(tmp, 'media', 'link'));
    expect(validateLibraryPath(path.join(tmp, 'media', 'link'), [path.join(tmp, 'media')]).ok).toBe(false);
  });

  it('resolveMediaPath blocks symlink escapes out of the library', () => {
    const lib = path.join(tmp, 'media', 'movies');
    fs.writeFileSync(path.join(lib, 'ok.mkv'), 'x');
    fs.symlinkSync(path.join(tmp, 'secret', 'passwd'), path.join(lib, 'evil.mkv'));
    expect(resolveMediaPath(lib, path.join(lib, 'ok.mkv'))).toBe(fs.realpathSync(path.join(lib, 'ok.mkv')));
    expect(resolveMediaPath(lib, path.join(lib, 'evil.mkv'))).toBeNull();
    expect(resolveMediaPath(lib, path.join(tmp, 'secret', 'passwd'))).toBeNull();
    expect(resolveMediaPath(lib, path.join(lib, 'missing.mkv'))).toBeNull();
  });

  it('image requests only accept whitelisted sizes and plain file names', () => {
    expect(isValidImageRequest('w342', 'abc.jpg')).toBe(true);
    expect(isValidImageRequest('w9999', 'abc.jpg')).toBe(false);
    expect(isValidImageRequest('w342', '../../etc/passwd')).toBe(false);
    expect(isValidImageRequest('w342', '..%2Fx.jpg')).toBe(false);
    expect(isValidImageRequest('w342', 'x.exe')).toBe(false);
  });
});

describe('HTTP path security', () => {
  let env: TestEnv;
  let admin: string;
  beforeEach(async () => {
    env = await createTestEnv();
    admin = await setupAdmin(env.app);
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('does not stream files whose symlink escapes the library', async () => {
    const outside = path.join(env.dir, 'outside.mkv');
    fs.writeFileSync(outside, 'secret');
    touch(path.join(env.mediaDir, 'movies', 'Real (2000).mkv'));
    fs.mkdirSync(path.join(env.mediaDir, 'movies'), { recursive: true });
    fs.symlinkSync(outside, path.join(env.mediaDir, 'movies', 'Sneaky (2001).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const list = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json();
    for (const m of list.items) {
      const detail = (await env.app.inject({ url: `/api/movies/${m.id}`, headers: { cookie: admin } })).json();
      for (const f of detail.files) {
        const res = await env.app.inject({ url: `/api/media/${f.id}/stream`, headers: { cookie: admin } });
        expect(res.body).not.toBe('secret');
      }
    }
  });

  it('rejects traversal attempts on image and subtitle routes', async () => {
    for (const url of ['/api/images/w342/..%2F..%2Fvelyx.db', '/api/images/w342/%2e%2e%2fvelyx.db', '/api/images/../../velyx.db', '/api/subtitles/..%2F1.vtt']) {
      const res = await env.app.inject({ url, headers: { cookie: admin } });
      expect([400, 404], url).toContain(res.statusCode);
    }
  });

  it('does not expose stack traces to regular users', async () => {
    const res = await env.app.inject({ url: '/api/movies?sort=%00', headers: { cookie: admin } });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/at .*\.ts:\d+/);
  });

  it('unknown API routes return JSON 404 and SPA routes are not served without a frontend build', async () => {
    const res = await env.app.inject({ url: '/api/does-not-exist', headers: { cookie: admin } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
