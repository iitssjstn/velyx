import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers.js';

const publicDir = path.resolve(import.meta.dirname, '../../frontend/public');
let env: TestEnv;
let frontend: string;

beforeEach(async () => {
  // What the build puts in the frontend folder: the public files plus index.html.
  frontend = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-frontend-'));
  fs.cpSync(publicDir, frontend, { recursive: true });
  fs.writeFileSync(path.join(frontend, 'index.html'), '<!doctype html><title>Velyx</title>');
  env = await createTestEnv({ frontendDir: frontend });
});
afterEach(async () => {
  await env.cleanup();
  fs.rmSync(frontend, { recursive: true, force: true });
});

const get = (url: string) => env.app.inject({ url });

describe('installing Velyx as an app', () => {
  it('serves the app manifest and icons without signing in', async () => {
    const manifest = await get('/manifest.webmanifest');
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['content-type']).toMatch(/^application\/manifest\+json/);
    const m = manifest.json();
    expect(m).toMatchObject({ name: 'Velyx', start_url: '/', scope: '/', display: 'standalone' });
    for (const icon of m.icons) {
      const res = await get(icon.src);
      expect(res.statusCode, icon.src).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    }
    expect((await get('/apple-touch-icon.png')).statusCode).toBe(200);
  });

  it('serves the service worker from the root, never cached, so updates reach every device', async () => {
    const sw = await get('/sw.js');
    expect(sw.statusCode).toBe(200);
    expect(sw.headers['content-type']).toMatch(/javascript/);
    expect(sw.headers['cache-control']).toBe('no-cache');
    // The offline page and its script are allowed by the content security policy (no inline script).
    const offline = await get('/offline.html');
    expect(offline.statusCode).toBe(200);
    expect(offline.body).not.toMatch(/<script>(?!<)/);
    expect(offline.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await get('/offline.js')).statusCode).toBe(200);
  });

  it('keeps the API out of the service worker', () => {
    const sw = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
    expect(sw).toContain("startsWith('/api/')");
    expect(sw).toContain("request.mode !== 'navigate'");
  });
});
