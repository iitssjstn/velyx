import { describe, expect, it } from 'vitest';
import { UpdateChecker, compareVersions } from '../src/services/updates.js';
import { APP_VERSION } from '../src/version.js';

const URL = 'https://vidalune.com/api/releases/latest';
const latest = (version: string, url = 'https://vidalune.com/install') => async (asked: string | URL | Request) => {
  expect(String(asked)).toBe(URL);
  return new Response(JSON.stringify({ version, url }), { status: 200 });
};

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('0.3.3', '0.4.0')).toBe(-1);
  });

  it('reports a newer version announced by vidalune.com, and ignores nonsense', async () => {
    const u = new UpdateChecker(URL, () => true, latest('99.0.1'));
    await u.check();
    expect(u.info()).toMatchObject({ current: APP_VERSION, latest: '99.0.1', available: true, url: 'https://vidalune.com/install' });
    const odd = new UpdateChecker(URL, () => true, latest('nightly', 'javascript:alert(1)'));
    await odd.check();
    expect(odd.info()).toMatchObject({ latest: null, available: false, url: null });
  });

  it('is quiet when up to date, offline or switched off', async () => {
    const same = new UpdateChecker(URL, () => true, latest(APP_VERSION));
    await same.check();
    expect(same.info().available).toBe(false);
    const offline = new UpdateChecker(URL, () => true, async () => {
      throw new Error('ENOTFOUND');
    });
    await offline.check();
    expect(offline.info()).toMatchObject({ available: false, latest: null });
    let calls = 0;
    const off = new UpdateChecker(URL, () => false, async () => {
      calls++;
      return new Response('[]');
    });
    expect(off.info().available).toBe(false);
    expect(calls).toBe(0);
  });
});
