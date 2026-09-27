import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mediaFiles } from '../src/db/schema.js';
import { addLibrary, createTestEnv, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let frontend: string;
const script = `console.log(${JSON.stringify('x'.repeat(4000))});`;

beforeEach(async () => {
  frontend = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-frontend-'));
  fs.mkdirSync(path.join(frontend, 'assets'));
  fs.writeFileSync(path.join(frontend, 'index.html'), '<!doctype html><title>Vidalune</title>');
  // As the build leaves them: a script with its precompressed copies, and one without.
  fs.writeFileSync(path.join(frontend, 'assets', 'app.js'), script);
  fs.writeFileSync(path.join(frontend, 'assets', 'app.js.br'), zlib.brotliCompressSync(script));
  fs.writeFileSync(path.join(frontend, 'assets', 'app.js.gz'), zlib.gzipSync(script));
  fs.writeFileSync(path.join(frontend, 'assets', 'other.js'), script);
  env = await createTestEnv({ frontendDir: frontend });
});
afterEach(async () => {
  await env.cleanup();
  fs.rmSync(frontend, { recursive: true, force: true });
});

describe('compression', () => {
  it('sends the precompressed copy of a built script', async () => {
    const br = await env.app.inject({ url: '/assets/app.js', headers: { 'accept-encoding': 'br, gzip' } });
    expect(br.headers['content-encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(br.rawPayload).toString()).toBe(script);
    const gz = await env.app.inject({ url: '/assets/app.js', headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
    const plain = await env.app.inject({ url: '/assets/app.js' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toBe(script);
  });

  it('gzips larger text answers on the fly, only when the client accepts it', async () => {
    const gz = await env.app.inject({ url: '/assets/other.js', headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gz.rawPayload).toString()).toBe(script);
    expect((await env.app.inject({ url: '/assets/other.js' })).headers['content-encoding']).toBeUndefined();
  });

  it('never compresses video, which stays seekable', async () => {
    const admin = await setupAdmin(env.app);
    touch(path.join(env.mediaDir, 'films', 'Alien (1979)', 'Alien.1979.mp4'), 'v'.repeat(10_000));
    await addLibrary(env, admin, 'movies', 'films');
    const file = env.ctx.db.select().from(mediaFiles).get()!;
    const res = await env.app.inject({ url: `/api/media/${file.id}/stream`, headers: { cookie: admin, 'accept-encoding': 'gzip', range: 'bytes=0-99' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-range']).toBe('bytes 0-99/10000');
  });
});
