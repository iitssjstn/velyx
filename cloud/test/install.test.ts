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
import { homePage } from '../src/site.js';

let dir: string;
let downloads: string;
let db: DB;
let app: FastifyInstance;
const version = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-install-'));
  downloads = path.join(dir, 'downloads');
  fs.mkdirSync(downloads);
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', DOWNLOAD_DIR: downloads }, { frontendDir: null });
  db = openDatabase(config.dbPath);
  app = await buildCloudApp(config, db);
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('installing Vidalune from vidalune.com', () => {
  it('explains that remote video connects directly to the server', () => {
    const en = homePage('en', false, false, 'https://vidalune.example', version);
    expect(en).toContain('one port must be reachable for video away from home');
    expect(en).toContain('Direct HTTPS connection to your server');
    expect(en).toContain('open one port to your server');
    expect(en).not.toContain('relay reaches your server');

    const nl = homePage('nl', false, false, 'https://vidalune.example', version);
    expect(nl).toContain('moet één poort bereikbaar zijn');
    expect(nl).toContain('Rechtstreekse HTTPS-verbinding met je server');
    expect(nl).toContain('moet één poort naar je server openstaan');
    expect(nl).not.toContain('relay je server');
  });

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
    expect(en.body).toContain('<link rel="canonical" href="https://vidalune.example/install?lang=en" />');
    expect(en.body).toContain('name="description" content="Install Vidalune on your own server');
    expect(en.body).toContain('curl -fsSL https://vidalune.example/get | sh');
    const nl = await app.inject({ url: '/install', headers: { 'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8' } });
    expect(nl.body).toContain('Vidalune installeren');
    expect((await app.inject({ url: '/install?lang=en', headers: { 'accept-language': 'nl' } })).body).toContain('Install Vidalune');

    const compose = await app.inject({ url: '/install/docker-compose.yml' });
    expect(compose.headers['content-disposition']).toContain('docker-compose.yml');
    expect(compose.body).toContain(`image: ${IMAGE}`);
    expect(compose.body).toContain('"${DIRECT_PUBLIC_PORT:-32400}:${DIRECT_TLS_PORT:-32400}"');
    expect(compose.body).toContain('DIRECT_TLS_PORT: ${DIRECT_TLS_PORT:-32400}');
    expect(compose.body).toContain('DIRECT_PUBLIC_PORT: ${DIRECT_PUBLIC_PORT:-32400}');
    expect(compose.body).toContain('/media/movies:ro');
  });

  it('hands out the newest Debian/Ubuntu package per processor, and explains it on the install page', async () => {
    expect((await app.inject({ url: '/download/deb/amd64' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/install' })).body).toContain('The package is not available for download right now.');

    fs.writeFileSync(path.join(downloads, 'vidalune_0.9.10_amd64.deb'), 'old');
    fs.writeFileSync(path.join(downloads, 'vidalune_0.16.0_amd64.deb'), 'new amd64');
    fs.writeFileSync(path.join(downloads, 'vidalune_0.16.0_arm64.deb'), 'new arm64');
    expect((await app.inject({ url: '/download/deb/amd64' })).headers.location).toBe('/download/vidalune_0.16.0_amd64.deb');
    expect((await app.inject({ url: '/download/deb/arm64' })).headers.location).toBe('/download/vidalune_0.16.0_arm64.deb');
    expect((await app.inject({ url: '/download/deb/i386' })).statusCode).toBe(400);
    const deb = await app.inject({ url: '/download/vidalune_0.16.0_arm64.deb' });
    expect(deb.headers['content-type']).toBe('application/vnd.debian.binary-package');
    expect(deb.body).toBe('new arm64');
    expect((await app.inject({ url: '/download/vidalune_0.16.0_i386.deb' })).statusCode).toBe(400);

    const page = (await app.inject({ url: '/install' })).body;
    expect(page).toContain('Without Docker (Debian/Ubuntu)');
    expect(page).toContain('curl -fLo vidalune.deb https://vidalune.example/download/deb/amd64');
    expect(page).toContain('curl -fsSL https://vidalune.example/get-deb | sudo sh');
    expect(page).toContain('Admin → Libraries');
    const nl = (await app.inject({ url: '/install?lang=nl' })).body;
    expect(nl).toContain('Zonder Docker (Debian/Ubuntu)');
    expect(nl).toContain('Beheer → Bibliotheken');
  });

  it('serves the signed apt repository, and nothing else from it', async () => {
    expect((await app.inject({ url: '/apt/InRelease' })).statusCode).toBe(404);
    fs.mkdirSync(path.join(downloads, 'apt'));
    fs.writeFileSync(path.join(downloads, 'apt', 'InRelease'), 'signed');
    fs.writeFileSync(path.join(downloads, 'apt', 'Packages.gz'), 'gz');
    fs.writeFileSync(path.join(downloads, 'apt', 'vidalune_0.16.1_amd64.deb'), 'deb');
    fs.writeFileSync(path.join(downloads, 'apt', 'secret.txt'), 'no');
    const inRelease = await app.inject({ url: '/apt/InRelease' });
    expect(inRelease.body).toBe('signed');
    expect(inRelease.headers['cache-control']).toBe('no-cache');
    expect((await app.inject({ url: '/apt/./InRelease' })).body).toBe('signed');
    expect((await app.inject({ url: '/apt/./Release' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/apt/./Packages.gz' })).headers['content-type']).toBe('application/gzip');
    expect((await app.inject({ url: '/apt/Packages.gz' })).headers['content-type']).toBe('application/gzip');
    const deb = await app.inject({ url: '/apt/vidalune_0.16.1_amd64.deb' });
    expect(deb.body).toBe('deb');
    expect(deb.headers['content-type']).toBe('application/vnd.debian.binary-package');
    expect((await app.inject({ url: '/apt/secret.txt' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/apt/..%2Fcloud.db' })).statusCode).toBe(400);
  });

  it('hands out a Debian/Ubuntu installer that installs the right package with apt (so FFmpeg comes along)', async () => {
    const res = await app.inject({ url: '/get-deb' });
    expect(res.headers['content-type']).toContain('text/plain');
    const script = res.body;
    expect(spawnSync('sh', ['-n'], { input: script }).status).toBe(0);

    // Stand-ins that record what they were asked: root, an arm64 Debian with apt and curl.
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const fake = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $@" >> "${dir}/calls.log"\n${body}\n`, { mode: 0o755 });
    fake('id', 'echo 0');
    fake('dpkg', 'echo arm64');
    fake('apt-get', '');
    fake('curl', 'while [ $# -gt 0 ]; do [ "$1" = -o ] && { shift; echo deb > "$1"; }; shift; done');
    fake('hostname', 'echo 192.168.1.20');
    const run = spawnSync('sh', [], { input: script, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const calls = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8');
    expect(calls).toContain('apt-get update -qq');
    expect(calls).toContain('https://vidalune.example/download/deb/arm64');
    expect(calls).toMatch(/apt-get install -y -qq \S+\/vidalune\.deb/);
    expect(run.stdout).toContain('http://192.168.1.20:3000');

    // Not as root: it says how, and changes nothing.
    fake('id', 'echo 1000');
    const user = spawnSync('sh', [], { input: script, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
    expect(user.status).toBe(1);
    expect(user.stdout).toContain('| sudo sh');
    // Another processor: it points to Docker.
    fake('id', 'echo 0');
    fake('dpkg', 'echo armhf');
    const armhf = spawnSync('sh', [], { input: script, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
    expect(armhf.status).toBe(1);
    expect(armhf.stdout).toContain('Docker');
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

  it('passes the graphics of the server to the container for video conversion, once', async () => {
    const script = (await app.inject({ url: '/get' })).body;
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\n[ "$1" = info ] && echo "Runtimes: io.containerd.runc.v2 nvidia runc"\nexit 0\n`, { mode: 0o755 });
    const install = (target: string, extra: Record<string, string>) =>
      spawnSync('sh', [], { input: script, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VIDALUNE_DIR: target, ...extra }, encoding: 'utf8' });

    // Intel/AMD: the graphics device is passed in; running the installer again does not add it twice.
    const dri = path.join(dir, 'dri');
    fs.mkdirSync(dri);
    const intel = path.join(dir, 'intel');
    expect(install(intel, { VIDALUNE_DRI: dri }).stdout).toContain('Intel/AMD graphics found');
    install(intel, { VIDALUNE_DRI: dri });
    const withDri = fs.readFileSync(path.join(intel, 'docker-compose.yml'), 'utf8');
    expect(withDri.match(/devices:/g)).toHaveLength(1);
    expect(withDri).toContain(`      - ${dri}:/dev/dri`);

    // NVIDIA with the container toolkit: the GPU is reserved for the container.
    fs.writeFileSync(path.join(bin, 'nvidia-smi'), '#!/bin/sh\necho "GPU 0: NVIDIA GeForce"\n', { mode: 0o755 });
    const nvidia = path.join(dir, 'nvidia');
    expect(install(nvidia, { VIDALUNE_DRI: path.join(dir, 'none') }).stdout).toContain('NVIDIA graphics found');
    const withNvidia = fs.readFileSync(path.join(nvidia, 'docker-compose.yml'), 'utf8');
    expect(withNvidia).toContain('- driver: nvidia');
    expect(withNvidia).toContain('capabilities: [gpu, video, compute, utility]');

    // A compose file someone wrote themselves is never changed.
    const own = path.join(dir, 'own');
    fs.mkdirSync(own);
    fs.writeFileSync(path.join(own, 'docker-compose.yml'), 'services:\n  vidalune:\n    image: x\n');
    install(own, { VIDALUNE_DRI: dri });
    expect(fs.readFileSync(path.join(own, 'docker-compose.yml'), 'utf8')).toBe('services:\n  vidalune:\n    image: x\n');
  });

  it('has a home page that explains Vidalune and leads to signing in, an account or installing', async () => {
    const en = await app.inject({ url: '/' });
    expect(en.headers['content-type']).toContain('text/html');
    for (const text of ['Your media. Your server.', 'href="/install"', 'href="/account?new"', 'Create account', 'id="features"', 'id="plans"']) expect(en.body).toContain(text);
    expect(en.body).toContain('<link rel="canonical" href="https://vidalune.example/?lang=en" />');
    expect(en.body).toContain('hreflang="nl" href="https://vidalune.example/?lang=nl"');
    expect(en.body).toContain('<meta property="og:title" content="Vidalune — your media, your server" />');
    const jsonLd = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(en.body);
    expect(jsonLd).not.toBeNull();
    expect(JSON.parse(jsonLd![1])).toMatchObject({
      '@context': 'https://schema.org',
      '@graph': expect.arrayContaining([
        expect.objectContaining({ '@type': 'Organization', name: 'Vidalune' }),
        expect.objectContaining({
          '@type': 'SoftwareApplication',
          softwareVersion: version,
          offers: expect.objectContaining({ priceCurrency: 'EUR', lowPrice: 0, highPrice: 5 }),
        }),
      ]),
    });
    const nl = await app.inject({ url: '/', headers: { 'accept-language': 'nl-NL,nl' } });
    expect(nl.body).toContain('Jouw media. Jouw server.');
    expect(nl.body).toContain('<link rel="canonical" href="https://vidalune.example/?lang=nl" />');
    expect(nl.body).toContain('Account maken');
    // Signed in: straight to your servers.
    const signUp = await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'justin@example.com', password: 'correct-horse' } });
    const cookie = `vl_session=${signUp.cookies.find((c) => c.name === 'vl_session')!.value}`;
    const signedIn = await app.inject({ url: '/', headers: { cookie } });
    expect(signedIn.body).toContain('My servers');
    expect(signedIn.body).not.toContain('Create account');
    expect((await app.inject({ url: '/install', headers: { cookie } })).body).toContain('My servers');
    // The account pages themselves live at /account.
    const account = await app.inject({ url: '/account' });
    expect(account.body).toContain('account.js');
  });

  it('publishes a localized sitemap and keeps account and app pages out of search results', async () => {
    const robots = await app.inject({ url: '/robots.txt' });
    expect(robots.headers['content-type']).toContain('text/plain');
    expect(robots.body).toContain('Sitemap: https://vidalune.example/sitemap.xml');
    expect(robots.body).toContain('Disallow: /api/');

    const appRobots = await app.inject({ url: '/robots.txt', headers: { host: 'app.vidalune.example' } });
    expect(appRobots.body).toContain('Disallow: /');

    const sitemap = await app.inject({ url: '/sitemap.xml' });
    expect(sitemap.headers['content-type']).toContain('application/xml');
    for (const url of [
      'https://vidalune.example/?lang=en',
      'https://vidalune.example/?lang=nl',
      'https://vidalune.example/install?lang=en',
      'https://vidalune.example/install?lang=nl',
    ]) expect(sitemap.body).toContain(`<loc>${url}</loc>`);
    expect(sitemap.body).toContain('hreflang="x-default"');
    expect(sitemap.body).not.toContain('/account');
    expect(sitemap.body).not.toContain('/admin');

    const account = await app.inject({ url: '/account' });
    expect(account.body).toContain('<meta name="robots" content="noindex, nofollow"');
  });
});
