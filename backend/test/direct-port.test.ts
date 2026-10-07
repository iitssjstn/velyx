import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { settings } from '../src/db/schema.js';
import { SettingsService } from '../src/services/settings.js';

let env: TestEnv;
let admin: string;

beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app, 'justin');
});

afterEach(async () => {
  env.ctx.cloud.shutdown();
  await env.cleanup();
});

describe('manual direct port forwarding', () => {
  it('returns the configured public port and internal listener port to administrators', async () => {
    const response = await env.app.inject({ url: '/api/admin/direct-port', headers: { cookie: admin } });
    expect(response.json()).toEqual({ publicPort: 32400, internalPort: 32400 });
  });

  it('lets administrators save a public port without enabling router automation', async () => {
    const response = await env.app.inject({
      method: 'PUT',
      url: '/api/admin/direct-port',
      headers: { cookie: admin },
      payload: { publicPort: 32401 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicPort: 32401, internalPort: 32400 });
    expect(env.ctx.settings.get().directPublicPort).toBe(32401);
    expect(env.ctx.settings.get()).not.toHaveProperty('upnp');
  });

  it('restricts changes to administrators and validates the port', async () => {
    const viewer = await createUser(env.app, admin, 'viewer');
    const forbidden = await env.app.inject({ method: 'PUT', url: '/api/admin/direct-port', headers: { cookie: viewer.cookie }, payload: { publicPort: 32401 } });
    const invalid = await env.app.inject({ method: 'PUT', url: '/api/admin/direct-port', headers: { cookie: admin }, payload: { publicPort: 80 } });
    expect(forbidden.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(400);
  });

  it('keeps a previously entered public port when upgrading from the old UPnP setting', () => {
    env.ctx.db.insert(settings).values({ key: 'upnp', value: JSON.stringify({ enabled: true, externalPort: 3000 }) }).run();
    const upgraded = new SettingsService(env.ctx.db, env.ctx.config);
    expect(upgraded.get().directPublicPort).toBe(3000);
    expect(upgraded.get()).not.toHaveProperty('upnp');
  });
});