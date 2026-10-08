import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder, openDatabase } from '../src/db/client.js';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';

const style = {
  size: 'large',
  color: 'yellow',
  background: 'translucent',
  edge: 'outline',
  position: 15,
  castDefaults: true,
};

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.cleanup();
});

describe('account subtitle style', () => {
  it('starts with device-local fallback, persists across sessions and keeps other preferences', async () => {
    const cookie = await setupAdmin(env.app);
    const headers = { cookie };
    const initial = await env.app.inject({ url: '/api/account/preferences', headers });
    expect(initial.json().subtitleStyle).toBeNull();
    const saved = await env.app.inject({
      method: 'PUT', url: '/api/account/preferences', headers,
      payload: { subtitleStyle: style, audioLanguage: 'NL', subtitleLanguage: 'en', subtitleFallback: 'nl', subtitleMode: 'foreign', skipIntro: 'always', skipCredits: 'never', skipRecap: 'ask' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      subtitleStyle: style, audioLanguage: 'nl', subtitleLanguage: 'en', subtitleFallback: 'nl',
      subtitleMode: 'foreign', skipIntro: 'always', skipCredits: 'never', skipRecap: 'ask',
    });
    const stored = env.ctx.db.$client.prepare('SELECT pref_subtitle_style AS style FROM users WHERE username = ?').get('admin') as { style: string };
    expect(JSON.parse(stored.style)).toEqual(style);

    const login = await env.app.inject({
      method: 'POST', url: '/api/auth/app/login',
      payload: { username: 'admin', password: 'correct-horse', deviceName: 'Second device' },
    });
    const secondHeaders = { authorization: ['Bearer', login.json().token].join(' ') };
    expect((await env.app.inject({ url: '/api/account/preferences', headers: secondHeaders })).json()).toEqual(saved.json());
    const changed = await env.app.inject({
      method: 'PUT', url: '/api/account/preferences', headers: secondHeaders, payload: { skipRecap: 'always' },
    });
    expect(changed.json()).toMatchObject({ subtitleStyle: style, audioLanguage: 'nl', skipRecap: 'always' });

    const cleared = await env.app.inject({
      method: 'PUT', url: '/api/account/preferences', headers, payload: { subtitleStyle: null },
    });
    expect(cleared.json()).toMatchObject({ subtitleStyle: null, audioLanguage: 'nl', skipRecap: 'always' });
    expect((await env.app.inject({ url: '/api/account/preferences', headers: secondHeaders })).json().subtitleStyle).toBeNull();
  });

  it('defaults castDefaults to false for an imported custom style', async () => {
    const cookie = await setupAdmin(env.app);
    const { castDefaults: _castDefaults, ...custom } = style;
    const saved = await env.app.inject({
      method: 'PUT', url: '/api/account/preferences', headers: { cookie }, payload: { subtitleStyle: custom },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().subtitleStyle).toEqual({ ...custom, castDefaults: false });
    expect((await env.app.inject({ url: '/api/account/preferences', headers: { cookie } })).json().subtitleStyle).toEqual({ ...custom, castDefaults: false });
  });

  it('accepts all supported choices and position boundaries', async () => {
    const cookie = await setupAdmin(env.app);
    for (const subtitleStyle of [
      { size: 'small', color: 'white', background: 'none', edge: 'shadow', position: 0, castDefaults: false },
      { size: 'medium', color: 'yellow', background: 'solid', edge: 'none', position: 5, castDefaults: true },
      { ...style, size: 'xlarge', position: 10 },
      { ...style, position: 20 },
    ]) {
      const saved = await env.app.inject({
        method: 'PUT', url: '/api/account/preferences', headers: { cookie }, payload: { subtitleStyle },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().subtitleStyle).toEqual(subtitleStyle);
    }
  });

  it('rejects invalid and unknown fields atomically', async () => {
    const cookie = await setupAdmin(env.app);
    await env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie }, payload: { subtitleStyle: style } });
    const invalid = [
      { ...style, size: 'huge' }, { ...style, color: 'red' }, { ...style, background: 'black' },
      { ...style, edge: 'glow' }, { ...style, position: -5 }, { ...style, position: 25 },
      { ...style, position: 1 }, { ...style, position: 5.5 }, { ...style, position: '5' },
      { ...style, castDefaults: 'false' }, { ...style, castDefaults: null },
      { ...style, unknown: true }, { size: 'small' }, [], 'style',
    ];
    for (const subtitleStyle of invalid) {
      const saved = await env.app.inject({
        method: 'PUT', url: '/api/account/preferences', headers: { cookie },
        payload: { subtitleStyle, audioLanguage: 'nl' },
      });
      expect(saved.statusCode).toBe(400);
    }
    const unknown = await env.app.inject({
      method: 'PUT', url: '/api/account/preferences', headers: { cookie }, payload: { subtitleStyle: style, userId: 2 },
    });
    expect(unknown.statusCode).toBe(200);
    expect((await env.app.inject({ url: '/api/account/preferences', headers: { cookie } })).json()).toMatchObject({ subtitleStyle: style, audioLanguage: '' });
  });

  it('requires authentication and only changes the signed-in account', async () => {
    const admin = await setupAdmin(env.app);
    const viewer = await createUser(env.app, admin, 'viewer');
    for (const headers of [{}, { cookie: 'velyx_session=forged.value' }]) {
      expect((await env.app.inject({ url: '/api/account/preferences', headers })).statusCode).toBe(401);
      expect((await env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers, payload: { subtitleStyle: style } })).statusCode).toBe(401);
    }
    const saved = await env.app.inject({
      method: 'PUT', url: '/api/account/preferences', headers: { cookie: viewer.cookie }, payload: { subtitleStyle: style },
    });
    expect(saved.statusCode).toBe(200);
    expect((await env.app.inject({ url: '/api/account/preferences', headers: { cookie: admin } })).json().subtitleStyle).toBeNull();
    expect((await env.app.inject({ url: '/api/account/preferences', headers: { cookie: viewer.cookie } })).json().subtitleStyle).toEqual(style);
    await env.app.inject({
      method: 'PUT', url: `/api/users/${viewer.id}`, headers: { cookie: admin }, payload: { disabled: true },
    });
    expect((await env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie: viewer.cookie }, payload: { subtitleStyle: null } })).statusCode).toBe(401);
  });

  it('upgrades an existing database without replacing language preferences or choosing an account style', () => {
    const folder = migrationsFolder();
    const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'));
    const previous = path.join(env.dir, 'previous-migrations');
    fs.mkdirSync(path.join(previous, 'meta'), { recursive: true });
    journal.entries.pop();
    fs.writeFileSync(path.join(previous, 'meta', '_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries) {
      fs.copyFileSync(path.join(folder, `${entry.tag}.sql`), path.join(previous, `${entry.tag}.sql`));
    }
    const file = path.join(env.dir, 'upgrade.db');
    const old = openDatabase(file, { migrationsFolder: previous });
    old.$client.prepare("INSERT INTO users (username, password_hash, pref_audio_language, pref_subtitle_language, language) VALUES ('existing', 'hash', 'nl', 'en', 'nl')").run();
    old.$client.close();
    const upgraded = openDatabase(file);
    try {
      expect(upgraded.$client.prepare('SELECT pref_subtitle_style, pref_audio_language, pref_subtitle_language, language FROM users').get()).toEqual({
        pref_subtitle_style: null, pref_audio_language: 'nl', pref_subtitle_language: 'en', language: 'nl',
      });
    } finally {
      upgraded.$client.close();
    }
  });
});
