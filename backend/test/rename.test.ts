import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { settings } from '../src/db/schema.js';
import { clientProfile } from '../src/playback/client-profile.js';
import { kindOf } from '../src/services/backup.js';
import { createTestEnv, setupAdmin, type TestEnv } from './helpers.js';

// Vidalune was called Velyx up to 0.9.7: installations, backups and apps from then keep working.
describe('the rename from Velyx', () => {
  it('recognises backups made under the old name next to new ones', () => {
    expect(kindOf('velyx-auto-2026-09-26T03-00-00.db')).toBe('auto');
    expect(kindOf('vidalune-auto-2026-09-26T03-00-00.db')).toBe('auto');
    expect(kindOf('velyx-manual-2026-09-26T03-00-00.db')).toBe('manual');
    expect(kindOf('velyx-backup-2026-09-26T03-00-00.tar.gz')).toBe('archive');
    expect(kindOf('vidalune-backup-2026-09-26T03-00-00.tar.gz')).toBe('archive');
    expect(kindOf('pre-migration-2026-09-26.db')).toBe('pre-migration');
    expect(kindOf('someone-else-auto-1.db')).toBeNull();
  });

  it('recognises the app under its old name', () => {
    expect(clientProfile('VelyxApp/0.9.7 (Android 15; Pixel 8)')).toMatchObject({ family: 'app', browser: 'Vidalune app' });
    expect(clientProfile('VidaluneApp/0.9.8 (Android 15; Pixel 8)')).toMatchObject({ family: 'app', browser: 'Vidalune app' });
  });

  it('honours the old name of the update setting', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-config-'));
    try {
      expect(loadConfig({ DATA_DIR: dataDir, VELYX_UPDATE_REPO: 'someone/old' }).updateRepo).toBe('someone/old');
      expect(loadConfig({ DATA_DIR: dataDir, VIDALUNE_UPDATE_REPO: 'someone/new', VELYX_UPDATE_REPO: 'someone/old' }).updateRepo).toBe('someone/new');
      expect(loadConfig({ DATA_DIR: dataDir }).updateRepo).toBe('iitssjstn/velyx');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  describe('on a server', () => {
    let env: TestEnv;
    beforeEach(async () => {
      env = await createTestEnv();
    });
    afterEach(async () => env.cleanup());

    it('shows the new name for a server that kept the old default name, and keeps names that were chosen', async () => {
      await setupAdmin(env.app, 'justin');
      const name = async () => (await env.app.inject({ url: '/api/server/info' })).json().name;
      // What a server set up as Velyx has stored.
      env.ctx.settings.update({ serverName: 'Velyx' });
      expect(env.ctx.db.select().from(settings).all().find((r) => r.key === 'serverName')?.value).toBe('"Velyx"');
      expect(await name()).toBe('Vidalune');
      env.ctx.settings.update({ serverName: 'Thuis' });
      expect(await name()).toBe('Thuis');
    });

    it('still reads the interface language from pages loaded before the rename', async () => {
      await setupAdmin(env.app, 'justin');
      const wrong = { username: 'justin', password: 'wrong-password-1' };
      const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-velyx-language': 'nl' }, payload: wrong });
      expect(res.json().error).toMatch(/wachtwoord/i);
    });
  });
});
