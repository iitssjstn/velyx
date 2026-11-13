import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pageAddresses, RELAY_TRIES, waitForRelay } from '../web/open.js';

const server = {
  relayUrl: 'https://abc.vidalune.com',
  relayConnected: false,
  url: 'https://vidalune.example.com',
  directAccess: { url: 'https://e742aa8b.media.vidalune.com:32400' },
  endpoints: [
    { type: 'lan', url: 'https://192-168-1-5.e742aa8b.media.vidalune.com:32400/' },
    { type: 'public', url: 'https://e742aa8b.media.vidalune.com:32400' },
  ],
};
// What /api/servers/:id/open hands out: home network first, then the direct address, its own, the relay.
const addresses = ['https://192-168-1-5.e742aa8b.media.vidalune.com:32400', 'https://e742aa8b.media.vidalune.com:32400', 'https://vidalune.example.com', 'https://abc.vidalune.com'];

describe('opening a server from the account pages', () => {
  it('never goes to the direct or home-network addresses: they only serve media and refuse the web interface', () => {
    expect(pageAddresses(addresses, server)).toEqual(['https://vidalune.example.com']);
    expect(pageAddresses(addresses, { ...server, relayConnected: true })).toEqual(['https://vidalune.example.com', 'https://abc.vidalune.com']);
    // Only media-only addresses and a relay that is not there: nowhere to go.
    expect(pageAddresses(addresses.slice(0, 2).concat('https://abc.vidalune.com'), server)).toEqual([]);
    expect(pageAddresses(undefined, server)).toEqual([]);
  });

  it('waits a few seconds for a relay that is reconnecting', async () => {
    const sleep = vi.fn(async () => undefined);
    const load = vi.fn().mockResolvedValueOnce({ ...server }).mockResolvedValueOnce({ ...server, relayConnected: true });
    const back = await waitForRelay(server, load, { sleep });
    expect(back.relayConnected).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('gives up after a few tries, and does not wait for a server without a relay or with it connected', async () => {
    const sleep = vi.fn(async () => undefined);
    const load = vi.fn(async () => ({ ...server }));
    expect((await waitForRelay(server, load, { sleep })).relayConnected).toBe(false);
    expect(load).toHaveBeenCalledTimes(RELAY_TRIES);
    const none = vi.fn(async () => null);
    await waitForRelay({ ...server, relayConnected: true }, none, { sleep });
    await waitForRelay({ relayUrl: null }, none, { sleep });
    expect(none).not.toHaveBeenCalled();
  });

  it('the account page uses it, as a module', () => {
    const web = path.join(import.meta.dirname, '../web');
    expect(fs.readFileSync(path.join(web, 'index.html'), 'utf8')).toContain('<script type="module" src="account.js"></script>');
    const js = fs.readFileSync(path.join(web, 'account.js'), 'utf8');
    expect(js).toContain("from './open.js'");
    expect(js).toContain('pageAddresses(addresses, s)');
  });
});
