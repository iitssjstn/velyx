import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { buildApp, createContext, type AppContext } from '../src/app.js';
import type { ProbeResult, Prober } from '../src/services/probe.js';
import type { FetchLike } from '../src/services/tmdb.js';
import { setLogLevel } from '../src/logger.js';

setLogLevel('error');

export function fakeProbe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    container: 'mkv',
    durationSec: 3600,
    bitrate: 5_000_000,
    videoCodec: 'h264',
    videoProfile: 'High',
    videoBitDepth: 8,
    videoRange: 'SDR',
    width: 1920,
    height: 1080,
    fps: 23.976,
    audioCodec: 'aac',
    audioChannels: 6,
    audioTracks: [{ index: 1, codec: 'aac', language: 'eng', channels: 6, channelLayout: '5.1', title: null, isDefault: true }],
    subtitleTracks: [],
    ...overrides,
  };
}

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  dir: string;
  mediaDir: string;
  probeCalls: string[];
  cleanup: () => Promise<void>;
}

export interface TestEnvOptions {
  fetchImpl?: FetchLike;
  tmdbKey?: string;
  prober?: Prober;
  watchDebounceMs?: number;
}

export async function createTestEnv(opts: TestEnvOptions = {}): Promise<TestEnv> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-test-'));
  const mediaDir = path.join(dir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const config = loadConfig(
    { DATA_DIR: path.join(dir, 'data'), MEDIA_ROOTS: mediaDir, TMDB_API_KEY: opts.tmdbKey ?? '', SESSION_SECRET: 'test-secret-test-secret-1234' } as NodeJS.ProcessEnv,
    { frontendDir: null },
  );
  const db = openDatabase(config.dbPath);
  const probeCalls: string[] = [];
  const prober: Prober =
    opts.prober ??
    (async (file) => {
      probeCalls.push(file);
      return fakeProbe({ container: path.extname(file).slice(1) });
    });
  const noNetwork: FetchLike = async () => {
    throw new Error('network disabled in tests');
  };
  const ctx = createContext(config, db, { prober, fetchImpl: opts.fetchImpl ?? noNetwork, tmdbMinIntervalMs: 0, watchDebounceMs: opts.watchDebounceMs });
  // Folder watching is opt-in per test (see watcher.test.ts) so other suites stay deterministic.
  ctx.settings.update({ watchFolders: false });
  const app = await buildApp(ctx);
  return {
    app,
    ctx,
    dir,
    mediaDir,
    probeCalls,
    cleanup: async () => {
      ctx.watcher.stop();
      ctx.scans.stop();
      await app.close();
      db.$client.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function touch(file: string, content = 'x'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Extracts the session cookie from a response so it can be sent with later requests. */
export function cookieFrom(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'velyx_session');
  if (!c) throw new Error('no session cookie');
  return `velyx_session=${c.value}`;
}

export async function setupAdmin(app: FastifyInstance, username = 'admin', password = 'correct-horse'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/setup', payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
  return cookieFrom(res);
}

export async function createUser(app: FastifyInstance, adminCookie: string, username: string, password = 'user-password', role: 'admin' | 'user' = 'user') {
  const res = await app.inject({ method: 'POST', url: '/api/users', headers: { cookie: adminCookie }, payload: { username, password, role } });
  if (res.statusCode !== 200) throw new Error(`create user failed: ${res.body}`);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  return { id: res.json().id as number, cookie: cookieFrom(login) };
}

export async function addLibrary(env: TestEnv, cookie: string, type: 'movies' | 'shows', sub: string) {
  const p = path.join(env.mediaDir, sub);
  fs.mkdirSync(p, { recursive: true });
  const res = await env.app.inject({ method: 'POST', url: '/api/libraries', headers: { cookie }, payload: { name: sub, type, path: p } });
  if (res.statusCode !== 200) throw new Error(`add library failed: ${res.body}`);
  await env.ctx.scans.whenIdle();
  return { id: res.json().id as number, path: p };
}

export async function rescan(env: TestEnv, libraryId: number, refreshMetadata = false) {
  env.ctx.scans.enqueue(libraryId, refreshMetadata);
  await env.ctx.scans.whenIdle();
}
