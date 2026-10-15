import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { ProgressSaver, progressReport, progressTarget, SAVE_EVERY_MS } from '../web/cast/progress.js';

let dir: string;
let db: DB;
let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  db?.$client.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** A request as a Chromecast makes it (the Host header decides what the service is). */
async function get(host: string, url: string, method = 'GET'): Promise<{ status: number; type: string; body: string; headers: http.IncomingHttpHeaders }> {
  const { port } = app.server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, type: String(res.headers['content-type'] ?? ''), body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function start() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cast-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example' });
  db = openDatabase(config.dbPath);
  app = await buildCloudApp(config, db);
  await app.listen({ port: 0, host: '127.0.0.1' });
}

describe('cast.vidalune.com', () => {
  it('serves Vidalune\'s cast player, and nothing else of the service', async () => {
    await start();
    const page = await get('cast.vidalune.example', '/');
    expect(page.status).toBe(200);
    expect(page.type).toContain('text/html');
    expect(page.body).toContain('https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js');
    expect(page.body).toContain('<cast-media-player>');
    expect(page.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    for (const [file, type] of [['receiver.js', 'text/javascript'], ['progress.js', 'text/javascript'], ['cast.css', 'text/css'], ['logo.svg', 'image/svg+xml']]) {
      const res = await get('cast.vidalune.example', `/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.type, file).toContain(type);
    }
    expect((await get('cast.vidalune.example', '/robots.txt')).body).toContain('Disallow: /');
    // Not the account service, not other files, not a relay address.
    for (const url of ['/api/account', '/account', '/progress.d.ts', '/../index.html', '/%2e%2e/index.html', '/admin']) expect((await get('cast.vidalune.example', url)).status, url).toBe(404);
    expect((await get('cast.vidalune.example', '/', 'POST')).status).toBe(404);
    expect(app.relay.slugOf({ headers: { host: 'cast.vidalune.example' } } as http.IncomingMessage)).toBeNull();
    // The website itself is unchanged.
    expect((await get('vidalune.example', '/')).body).not.toContain('cast-media-player');
  });
});

describe('the cast player saving where the TV is', () => {
  const item = { url: 'https://abc.media.vidalune.com:32400/api/cast/progress?cast=t', offset: 0, durationSec: 6000 };

  it('takes the address only from a Vidalune sender, over https', () => {
    expect(progressTarget({ vidalune: { progressUrl: item.url, offset: 0, durationSec: 6000 } })).toEqual(item);
    expect(progressTarget({ vidalune: { progressUrl: 'http://192.168.1.5/api/cast/progress' } })).toBeNull();
    expect(progressTarget(undefined)).toBeNull();
    expect(progressTarget({ other: true })).toBeNull();
  });

  it('saves the position in the file, the length, and the end as watched to the end', () => {
    expect(progressReport(item, 600.04, 6000)).toEqual({ positionSec: 600, durationSec: 6000 });
    // A stream that starts later in the file counts from there; without a length, the stream's.
    expect(progressReport({ ...item, offset: 120, durationSec: 0 }, 30, 5880)).toEqual({ positionSec: 150, durationSec: 6000 });
    expect(progressReport(item, 5990, 6000, true)).toEqual({ positionSec: 6000, durationSec: 6000 });
    // Not started, or no length: nothing.
    expect(progressReport(item, 0, 6000)).toBeNull();
    expect(progressReport({ ...item, durationSec: 0 }, 10, Number.NaN)).toBeNull();
  });

  it('saves every 10 seconds while playing, at once on pause and stop, and never for a title that did not play', async () => {
    let clock = 0;
    const sent: Array<{ url: string; body: unknown }> = [];
    const saver = new ProgressSaver((url, body) => sent.push({ url, body }), () => clock);
    const flush = () => new Promise((r) => setTimeout(r, 0));
    saver.start(item);
    // Loaded at its resume point but stopped before it played: the resume point is kept.
    saver.save(0, 6000);
    saver.finish(0, 6000);
    await flush();
    expect(sent).toEqual([]);

    saver.start(item);
    clock = SAVE_EVERY_MS;
    saver.tick(100, 6000);
    clock += 1000;
    saver.tick(101, 6000);
    await flush();
    expect(sent.map((s) => s.body)).toEqual([{ positionSec: 100, durationSec: 6000 }]);
    clock += SAVE_EVERY_MS;
    saver.tick(111, 6000);
    saver.save(112, 6000);
    saver.finish(113, 6000);
    await flush();
    expect(sent.map((s) => s.body)).toEqual([100, 111, 112, 113].map((positionSec) => ({ positionSec, durationSec: 6000 })));
    expect(sent.every((s) => s.url === item.url)).toBe(true);
    // After it finished nothing more goes out for it.
    saver.tick(200, 6000);
    await flush();
    expect(sent).toHaveLength(4);
  });

  it('keeps going when a save fails', async () => {
    let calls = 0;
    const saver = new ProgressSaver(() => {
      calls++;
      throw new Error('offline');
    });
    saver.start(item);
    saver.tick(50, 6000);
    saver.save(60, 6000);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });
});
