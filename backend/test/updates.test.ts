import { describe, expect, it } from 'vitest';
import { UpdateChecker, compareVersions } from '../src/services/updates.js';
import { APP_VERSION } from '../src/version.js';

const tags = (names: string[]) => async () => new Response(JSON.stringify(names.map((name) => ({ name }))), { status: 200 });

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('0.3.3', '0.4.0')).toBe(-1);
  });

  it('reports a newer tag and ignores other tags', async () => {
    const u = new UpdateChecker('iitssjstn/velyx', () => true, tags(['v0.2.0', `v${APP_VERSION}`, 'v99.0.1', 'nightly', 'v99.0.0-rc1']));
    await u.check();
    expect(u.info()).toMatchObject({ current: APP_VERSION, latest: '99.0.1', available: true, url: 'https://github.com/iitssjstn/velyx/releases/tag/v99.0.1' });
  });

  it('is quiet when up to date, offline or switched off', async () => {
    const same = new UpdateChecker('iitssjstn/velyx', () => true, tags([`v${APP_VERSION}`]));
    await same.check();
    expect(same.info().available).toBe(false);
    const offline = new UpdateChecker('iitssjstn/velyx', () => true, async () => {
      throw new Error('ENOTFOUND');
    });
    await offline.check();
    expect(offline.info()).toMatchObject({ available: false, latest: null });
    let calls = 0;
    const off = new UpdateChecker('iitssjstn/velyx', () => false, async () => {
      calls++;
      return new Response('[]');
    });
    expect(off.info().available).toBe(false);
    expect(calls).toBe(0);
  });
});
