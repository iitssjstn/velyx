import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';
import { adminNotifications, auditLog, cleanupPlanned, mediaFiles, users, watchProgress } from '../src/db/schema.js';
import { matchesCustomRule, type FileFacts } from '../src/services/cleanup.js';
import { MESSAGES } from '../src/services/notifications.js';
import { hasTranslation } from '../src/i18n/index.js';
import type { CustomCleanupRule } from '../src/services/settings.js';

const DAY = 86_400_000;
const GB = 1024 ** 3;
const WEBHOOK = 'https://discord.com/api/webhooks/123456789012/abcdefghijklmnopqrstuvwxyz_ABCDEFG';

const rule = (over: Partial<CustomCleanupRule> = {}): CustomCleanupRule => ({
  id: 'r1',
  name: 'Seen by all',
  enabled: true,
  libraryId: null,
  kind: 'all',
  watched: 'everyone',
  addedDays: 30,
  notPlayedDays: null,
  minGb: null,
  action: 'suggest',
  graceDays: 7,
  ...over,
});

describe('own clean-up rules: matching', () => {
  const now = 1_000 * DAY;
  const file = (over: Partial<FileFacts> = {}): FileFacts => ({ kind: 'movie', libraryId: 1, size: 5 * GB, addedAt: now - 60 * DAY, started: true, watchedBy: 2, audience: 2, lastWatchedAt: now - 40 * DAY, ...over });

  it('needs every condition that is set', () => {
    expect(matchesCustomRule(rule(), file(), now)).toBe(true);
    expect(matchesCustomRule(rule(), file({ watchedBy: 1 }), now)).toBe(false);
    expect(matchesCustomRule(rule(), file({ addedAt: now - 10 * DAY }), now)).toBe(false);
    expect(matchesCustomRule(rule({ kind: 'episode' }), file(), now)).toBe(false);
    expect(matchesCustomRule(rule({ libraryId: 2 }), file(), now)).toBe(false);
    expect(matchesCustomRule(rule({ minGb: 10 }), file(), now)).toBe(false);
    expect(matchesCustomRule(rule({ notPlayedDays: 30 }), file(), now)).toBe(true);
    expect(matchesCustomRule(rule({ notPlayedDays: 60 }), file(), now)).toBe(false);
  });

  it('counts "never played" from when the file was added', () => {
    const r = rule({ watched: 'nobody', addedDays: null, notPlayedDays: 30 });
    expect(matchesCustomRule(r, file({ started: false, watchedBy: 0, lastWatchedAt: null }), now)).toBe(true);
    expect(matchesCustomRule(r, file({ started: false, watchedBy: 0, lastWatchedAt: null, addedAt: now - 5 * DAY }), now)).toBe(false);
  });

  it('never matches when off, without conditions, or for a library nobody can see', () => {
    expect(matchesCustomRule(rule({ enabled: false }), file(), now)).toBe(false);
    expect(matchesCustomRule(rule({ watched: 'any', addedDays: null }), file(), now)).toBe(false);
    expect(matchesCustomRule(rule(), file({ audience: 0, watchedBy: 0 }), now)).toBe(false);
  });
});

describe('own clean-up rules, planned deletions and notifications', () => {
  let env: TestEnv;
  let admin: string;
  let posts: Array<{ url: string; body: { content: string; allowed_mentions: unknown } }>;

  beforeEach(async () => {
    posts = [];
    env = await createTestEnv({
      fetchImpl: async (url, init) => {
        posts.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: 204 });
      },
    });
    admin = await setupAdmin(env.app, 'justin');
    for (const f of ['Alien (1979)/Alien.1979.mkv', 'Dune (2021)/Dune.2021.mkv']) touch(path.join(env.mediaDir, 'films', f), 'x'.repeat(100));
    await addLibrary(env, admin, 'movies', 'films');
    const db = env.ctx.db;
    const me = db.select().from(users).where(eq(users.username, 'justin')).get()!;
    const alien = db.select().from(mediaFiles).all().find((f) => f.path.endsWith('Alien.1979.mkv'))!;
    db.update(mediaFiles).set({ addedAt: Date.now() - 90 * DAY }).run();
    db.insert(watchProgress).values({ userId: me.id, movieId: alien.movieId, positionSec: 100, durationSec: 100, completed: true, playCount: 1, updatedAt: Date.now() - 45 * DAY }).run();
  });
  afterEach(async () => {
    // Saving rules runs them right away (in the background): let that finish first.
    await new Promise((r) => setImmediate(r));
    await env.ctx.scans.whenIdle();
    await env.cleanup();
  });

  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => env.app.inject({ method, url, headers: { cookie: admin }, ...(payload ? { payload } : {}) });
  const alienId = () => env.ctx.db.select().from(mediaFiles).all().find((f) => f.path.endsWith('Alien.1979.mkv'))!.id;
  const save = (rules: Array<Partial<CustomCleanupRule>>) => inject('PUT', '/api/admin/cleanup/rules', { rules: rules.map((r) => { const { id: _id, ...rest } = rule(r); return rest; }) });

  it('validates rules and previews what a rule would catch', async () => {
    expect((await save([{ watched: 'any', addedDays: null }])).statusCode).toBe(400);
    const preview = (await inject('POST', '/api/admin/cleanup/rules/preview', { rule: { ...rule(), id: undefined } })).json();
    expect(preview).toMatchObject({ files: 1, items: [{ title: 'Alien' }] });
    // Only administrators.
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await env.app.inject({ method: 'GET', url: '/api/admin/cleanup/rules', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
  });

  it('suggests matches with the rule name as the reason', async () => {
    expect((await save([{}])).statusCode).toBe(200);
    const list = (await inject('GET', '/api/admin/cleanup?rule=custom')).json();
    expect(list.items).toMatchObject([{ title: 'Alien', reasons: expect.arrayContaining([expect.objectContaining({ rule: 'custom', text: 'Your rule "Seen by all"' })]), plan: null }]);
  });

  it('plans a deletion, notifies administrators, and keeping the file stops it', async () => {
    await inject('PUT', '/api/admin/notifications/settings', { discordWebhook: WEBHOOK });
    await save([{ action: 'delete', graceDays: 7 }]);
    const run = env.ctx.cleanupScheduler.run();
    expect(run.planned).toBe(1);
    const planned = (await inject('GET', '/api/admin/cleanup/planned')).json();
    expect(planned).toMatchObject([{ title: 'Alien', rule: 'Seen by all' }]);
    expect(planned[0].dueAt).toBeGreaterThan(Date.now() + 6 * DAY);
    // Bell and Discord (titles only, no mentions).
    const bell = (await inject('GET', '/api/admin/notifications')).json();
    expect(bell.unread).toBe(1);
    expect(bell.items[0]).toMatchObject({ event: 'cleanupPlanned', read: false, body: expect.stringContaining('Alien') });
    await new Promise((r) => setTimeout(r, 10));
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(WEBHOOK);
    expect(posts[0].body.content).toContain('Alien');
    expect(posts[0].body.content).not.toContain('Alien.1979.mkv');
    expect(posts[0].body.allowed_mentions).toEqual({ parse: [] });
    // Keeping stops the plan.
    await inject('POST', '/api/admin/cleanup/keep', { fileIds: [alienId()] });
    expect((await inject('GET', '/api/admin/cleanup/planned')).json()).toEqual([]);
    await inject('POST', '/api/admin/notifications/read');
    expect((await inject('GET', '/api/admin/notifications/unread')).json()).toEqual({ unread: 0 });
  });

  it('deletes on the day only while deleting is allowed, and records it', async () => {
    await save([{ action: 'delete', graceDays: 1 }]);
    env.ctx.cleanupScheduler.run();
    const file = path.join(env.mediaDir, 'films', 'Alien (1979)', 'Alien.1979.mkv');
    const later = Date.now() + 2 * DAY;
    // Deleting is off: the plan waits.
    expect(env.ctx.cleanupScheduler.run(later).deleted).toBe(0);
    expect(fs.existsSync(file)).toBe(true);
    await inject('PUT', '/api/admin/cleanup/settings', { deletion: true });
    expect(env.ctx.cleanupScheduler.run(later).deleted).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    // The library is scanned again afterwards.
    await env.ctx.scans.whenIdle();
    expect(env.ctx.db.select().from(cleanupPlanned).all()).toEqual([]);
    const audit = env.ctx.db.select().from(auditLog).where(eq(auditLog.action, 'cleanup.deleted')).all();
    expect(audit).toMatchObject([{ actorName: 'rule: Seen by all' }]);
    expect(env.ctx.db.select().from(adminNotifications).all().map((n) => n.event)).toEqual(['cleanupPlanned', 'cleanupDeleted']);
  });

  it('drops plans when the rule is turned off', async () => {
    await save([{ action: 'delete' }]);
    env.ctx.cleanupScheduler.run();
    await save([{ action: 'delete', enabled: false }]);
    env.ctx.cleanupScheduler.run();
    expect(env.ctx.db.select().from(cleanupPlanned).all()).toEqual([]);
  });

  it('only accepts Discord webhook addresses, never returns them, and tests the channel', async () => {
    expect((await inject('PUT', '/api/admin/notifications/settings', { discordWebhook: 'http://192.168.1.1/hook' })).statusCode).toBe(400);
    expect((await inject('POST', '/api/admin/notifications/test')).statusCode).toBe(400);
    const saved = (await inject('PUT', '/api/admin/notifications/settings', { discordWebhook: WEBHOOK, events: { newDevice: true } })).json();
    expect(JSON.stringify(saved)).not.toContain('abcdefghij');
    expect(saved).toMatchObject({ discord: { configured: true }, events: { newDevice: true, cleanupPlanned: true } });
    expect((await inject('POST', '/api/admin/notifications/test')).json()).toEqual({ ok: true, error: null });
    expect(posts.at(-1)!.body.content).toContain('Test message');
  });

  it('keeps events that are off out of the bell', async () => {
    await inject('PUT', '/api/admin/notifications/settings', { events: { cleanupPlanned: false } });
    await save([{ action: 'delete' }]);
    env.ctx.cleanupScheduler.run();
    expect((await inject('GET', '/api/admin/notifications')).json()).toMatchObject({ items: [], unread: 0 });
  });
});

describe('notification texts', () => {
  it('have a Dutch translation', () => {
    for (const m of Object.values(MESSAGES)) {
      expect(hasTranslation(m.title), m.title).toBe(true);
      expect(hasTranslation(m.body), m.body).toBe(true);
    }
  });
});
