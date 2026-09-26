import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder, openDatabase } from '../src/db/client.js';
import { addLibrary, cookieFrom, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(() => env.cleanup());

const me = async (cookie: string) => (await env.app.inject({ url: '/api/auth/me', headers: { cookie } })).json().user;
const setLanguage = (cookie: string, language: unknown) => env.app.inject({ method: 'PUT', url: '/api/account/language', headers: { cookie }, payload: { language } });

describe('interface language', () => {
  it('is English by default', async () => {
    expect(await me(admin)).toMatchObject({ language: 'en' });
    const anna = await createUser(env.app, admin, 'anna');
    expect(await me(anna.cookie)).toMatchObject({ language: 'en' });
  });

  it('is chosen per user, kept after signing out and in again, and never signs the user out', async () => {
    const anna = await createUser(env.app, admin, 'anna');
    const res = await setLanguage(anna.cookie, 'nl');
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ username: 'anna', language: 'nl' });
    // The same session keeps working.
    expect(await me(anna.cookie)).toMatchObject({ language: 'nl' });
    // Other users are not affected.
    expect(await me(admin)).toMatchObject({ language: 'en' });
    await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: anna.cookie } });
    const login = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password: 'user-password' } });
    expect(login.json().user).toMatchObject({ language: 'nl' });
    expect(await me(cookieFrom(login))).toMatchObject({ language: 'nl' });
  });

  it('accepts only languages Velyx has', async () => {
    for (const bad of ['javascript', 'de', 'NL', '', null, 1, 'en-US']) {
      const res = await setLanguage(admin, bad);
      expect(res.statusCode).toBe(400);
    }
    expect((await setLanguage(admin, 'nl')).statusCode).toBe(200);
    expect((await env.app.inject({ method: 'PUT', url: '/api/account/language', payload: { language: 'nl' } })).statusCode).toBe(401);
    expect(await me(admin)).toMatchObject({ language: 'nl' });
  });

  it('is separate from the audio and subtitle languages', async () => {
    await env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie: admin }, payload: { audioLanguage: 'en', subtitleLanguage: 'en', subtitleMode: 'always' } });
    await setLanguage(admin, 'nl');
    const prefs = (await env.app.inject({ url: '/api/account/preferences', headers: { cookie: admin } })).json();
    expect(prefs).toMatchObject({ audioLanguage: 'en', subtitleLanguage: 'en', subtitleMode: 'always' });
  });

  it('answers every user in their own language at the same time', async () => {
    const anna = await createUser(env.app, admin, 'anna');
    await setLanguage(anna.cookie, 'nl');
    const missing = (cookie: string) => env.app.inject({ url: '/api/movies/9999', headers: { cookie } });
    expect((await missing(anna.cookie)).json().error).toBe('Film niet gevonden.');
    expect((await missing(admin)).json().error).toBe('Movie not found.');
    // Validation errors too.
    const bad = await env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie: anna.cookie }, payload: { subtitleMode: 'sometimes' } });
    expect(bad.json().error).toBe('subtitleMode: Deze waarde is ongeldig.');
    const tooShort = await env.app.inject({ method: 'POST', url: '/api/account/password', headers: { cookie: anna.cookie }, payload: { currentPassword: 'user-password', newPassword: 'short' } });
    expect(tooShort.json().error).toBe('Het wachtwoord moet minstens 8 tekens hebben.');
    // Only for administrators.
    expect((await env.app.inject({ url: '/api/admin/health', headers: { cookie: anna.cookie } })).json().error).toBe('Alleen beheerders kunnen dit doen.');
  });

  it('uses the language the browser asks for before signing in', async () => {
    const wrong = { username: 'admin', password: 'wrong-password' };
    const nl = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-velyx-language': 'nl' }, payload: wrong });
    expect(nl.json().error).toBe('Gebruikersnaam of wachtwoord onjuist.');
    const accept = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8' }, payload: wrong });
    expect(accept.json().error).toBe('Gebruikersnaam of wachtwoord onjuist.');
    const unknown = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-velyx-language': 'klingon' }, payload: wrong });
    expect(unknown.json().error).toBe('Incorrect username or password.');
  });

  it('starts the first administrator in the language chosen during setup', async () => {
    const fresh = await createTestEnv();
    try {
      const res = await fresh.app.inject({ method: 'POST', url: '/api/setup', payload: { username: 'beheer', password: 'correct-horse', language: 'nl' } });
      expect(res.json().user).toMatchObject({ language: 'nl' });
      const bad = await fresh.app.inject({ method: 'POST', url: '/api/setup', payload: { username: 'x', password: 'correct-horse', language: 'javascript' } });
      expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await fresh.cleanup();
    }
  });

  it('explains playback in the user\'s language', async () => {
    touch(path.join(env.mediaDir, 'movies', 'Dune (2021).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const movieId = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json().items[0].id;
    const fileId = (await env.app.inject({ url: `/api/movies/${movieId}`, headers: { cookie: admin } })).json().files[0].id;
    await setLanguage(admin, 'nl');
    const caps = { containers: ['mp4', 'webm', 'mkv'], videoCodecs: ['h264'], audioCodecs: ['opus'] };
    const a = (await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { cookie: admin }, payload: caps })).json().analysis;
    expect(a.mode).toBe('remux');
    expect(a.summary).toContain('De video hoeft niet te worden getranscodeerd.');
    expect(a.components.audio.note).toMatch(/^Omgezet naar AAC stereo/);
    // Codec names are not translated.
    expect(a.video.label).toBe('H.264');
  });

  it('upgrades an existing database: every existing user starts in English, nothing else changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-lang-'));
    try {
      // The migrations of 0.5.8 (all but the language one).
      const old = path.join(dir, 'old');
      fs.cpSync(migrationsFolder(), old, { recursive: true });
      const journalFile = path.join(old, 'meta', '_journal.json');
      const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
      const last = journal.entries.pop();
      expect(last.tag).toBe('0016_interface_language');
      fs.writeFileSync(journalFile, JSON.stringify(journal));
      const file = path.join(dir, 'velyx.db');
      const before = openDatabase(file, { migrationsFolder: old });
      before.$client.prepare("INSERT INTO users (username, password_hash, role, pref_audio_language) VALUES ('oud', 'x', 'admin', 'nl')").run();
      expect(before.$client.prepare('PRAGMA table_info(users)').all().some((c) => (c as { name: string }).name === 'language')).toBe(false);
      before.$client.close();
      const after = openDatabase(file, { backupDir: path.join(dir, 'backups') });
      expect(after.$client.prepare("SELECT username, language, pref_audio_language AS audio FROM users").get()).toEqual({ username: 'oud', language: 'en', audio: 'nl' });
      after.$client.close();
      // A safety copy was made before migrating.
      expect(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('pre-migration-'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
