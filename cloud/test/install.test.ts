import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { IMAGE } from '../src/install.js';

let dir: string;
let downloads: string;
let db: DB;
let app: FastifyInstance;
const version = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-install-'));
  downloads = path.join(dir, 'downloads');
  fs.mkdirSync(downloads);
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', DOWNLOAD_DIR: downloads });
  db = openDatabase(config.dbPath);
  app = await buildCloudApp(config, db);
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('installing Vidalune from vidalune.com', () => {
  it('announces the latest version for the update check, and the app once there is one', async () => {
    const none = await app.inject({ url: '/api/releases/latest' });
    expect(none.json()).toEqual({ version, url: 'https://vidalune.example/install', app: null });
    expect(none.headers['cache-control']).toContain('max-age');
    expect((await app.inject({ url: '/download/app' })).statusCode).toBe(404);

    fs.writeFileSync(path.join(downloads, 'vidalune-0.9.10.apk'), 'old');
    fs.writeFileSync(path.join(downloads, 'vidalune-0.10.2.apk'), 'new app');
    expect((await app.inject({ url: '/api/releases/latest' })).json().app).toBe('https://vidalune.example/download/app');
    const latest = await app.inject({ url: '/download/app' });
    expect(latest.headers.location).toBe('/download/vidalune-0.10.2.apk');
    const apk = await app.inject({ url: '/download/vidalune-0.10.2.apk' });
    expect(apk.statusCode).toBe(200);
    expect(apk.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(apk.headers['content-disposition']).toContain('vidalune-0.10.2.apk');
    expect(apk.body).toBe('new app');
    // Only app files, never anything else from the folder (or outside it).
    fs.writeFileSync(path.join(downloads, 'secret.txt'), 'no');
    expect((await app.inject({ url: '/download/secret.txt' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/download/..%2Fcloud.db' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/download/vidalune-9.9.9.apk' })).statusCode).toBe(404);
  });

  it('shows the install page in the visitor\'s language, with a compose file to download', async () => {
    const en = await app.inject({ url: '/install' });
    expect(en.headers['content-type']).toContain('text/html');
    expect(en.body).toContain('Install Vidalune');
    expect(en.body).toContain('curl -fsSL https://vidalune.example/get | sh');
    const nl = await app.inject({ url: '/install', headers: { 'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8' } });
    expect(nl.body).toContain('Vidalune installeren');
    expect((await app.inject({ url: '/install?lang=en', headers: { 'accept-language': 'nl' } })).body).toContain('Install Vidalune');

    const compose = await app.inject({ url: '/install/docker-compose.yml' });
    expect(compose.headers['content-disposition']).toContain('docker-compose.yml');
    expect(compose.body).toContain(`image: ${IMAGE}`);
    expect(compose.body).toContain('/media/movies:ro');
  });

  it('hands out an installer that writes the compose file and starts Vidalune', async () => {
    const script = (await app.inject({ url: '/get' })).body;
    expect(spawnSync('sh', ['-n'], { input: script }).status).toBe(0);

    // A stand-in for docker that only records what it was asked.
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\necho "$@" >> "${dir}/docker.log"\n`, { mode: 0o755 });
    const target = path.join(dir, 'vidalune');
    const run = spawnSync('sh', [], { input: script, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VIDALUNE_DIR: target, TZ: 'Europe/Amsterdam' }, encoding: 'utf8' });
    expect(run.status).toBe(0);
    const written = fs.readFileSync(path.join(target, 'docker-compose.yml'), 'utf8');
    expect(written).toContain(`image: ${IMAGE}`);
    // No terminal to ask: the default folders, and this user's own ids.
    expect(written).toContain('- /srv/media/movies:/media/movies:ro');
    expect(written).toContain(`PUID: "${process.getuid!()}"`);
    expect(written).toContain('TZ: Europe/Amsterdam');
    expect(fs.readFileSync(path.join(dir, 'docker.log'), 'utf8')).toMatch(/compose pull\ncompose up -d/);
    expect(run.stdout).toContain(':3000');
  });
});
