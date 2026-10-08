import { describe, expect, it, vi } from 'vitest';
import { CloudflareDns, publicAddress } from '../src/cloudflare-dns.js';

const json = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });

describe('Cloudflare direct DNS records', () => {
  it('accepts public IPv4/IPv6 and rejects non-public ranges', () => {
    expect(publicAddress('8.8.8.8')).toBe('8.8.8.8');
    expect(publicAddress('::ffff:8.8.8.8')).toBe('8.8.8.8');
    expect(publicAddress('2606:4700:4700::1111')).toBe('2606:4700:4700::1111');
    for (const address of ['127.0.0.1', '192.168.1.4', '203.0.113.8', 'fe80::1', '2001:db8::1']) expect(publicAddress(address)).toBeNull();
  });

  it('creates an unproxied A record under the configured zone', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/zones?')) return json([{ id: 'zone-1', name: 'vidalune.com' }]);
      if (url.includes('/dns_records?')) return json([]);
      return json({ id: 'record-1' });
    };
    const dns = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl, apiBase: 'https://cf.test' });

    await dns.upsertAddress('server-1.media.vidalune.com', '203.0.113.20');

    expect(calls.map((call) => call.init?.method ?? 'GET')).toEqual(['GET', 'GET', 'POST']);
    expect(calls[2]?.url).toBe('https://cf.test/zones/zone-1/dns_records');
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({
      type: 'A',
      name: 'server-1.media.vidalune.com',
      content: '203.0.113.20',
      ttl: 120,
      proxied: false,
    });
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('returns the authoritative nameservers from the configured Cloudflare zone', async () => {
    const fetchImpl: typeof fetch = async () => json([{ id: 'zone-1', name: 'vidalune.com', name_servers: ['ns1.cloudflare.test', 'ns2.cloudflare.test'] }]);
    const dns = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl, apiBase: 'https://cf.test' });

    await expect(dns.authoritativeNameServers()).resolves.toEqual(['ns1.cloudflare.test', 'ns2.cloudflare.test']);
  });

  it('updates changed addresses and skips writes when the record is current', async () => {
    const updates: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/zones?')) return json([{ id: 'zone-1', name: 'vidalune.com' }]);
      if (url.includes('/dns_records?')) return json([{ id: 'record-1', type: 'A', name: 's.media.vidalune.com', content: '198.51.100.1', proxied: false }]);
      updates.push({ url, init });
      return json({ id: 'record-1' });
    };
    const dns = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl, apiBase: 'https://cf.test' });

    await dns.upsertAddress('s.media.vidalune.com', '198.51.100.2');
    expect(updates).toEqual([{ url: 'https://cf.test/zones/zone-1/dns_records/record-1', init: expect.objectContaining({ method: 'PUT' }) }]);

    const currentFetch: typeof fetch = async (input) => String(input).includes('/zones?')
      ? json([{ id: 'zone-1', name: 'vidalune.com' }])
      : json([{ id: 'record-1', type: 'A', name: 's.media.vidalune.com', content: '198.51.100.2', proxied: false }]);
    const current = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl: currentFetch, apiBase: 'https://cf.test' });
    await current.upsertAddress('s.media.vidalune.com', '198.51.100.2');
  });

  it('removes a stale A record when the observed public address changes to IPv6', async () => {
    const methods: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      methods.push(init?.method ?? 'GET');
      if (url.includes('/zones?')) return json([{ id: 'zone-1', name: 'vidalune.com' }]);
      if (url.includes('/dns_records?')) return json([{ id: 'old-a', type: 'A', name: 's.media.vidalune.com', content: '8.8.8.8', proxied: false }]);
      return json({ id: 'record-1' });
    };
    const dns = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl, apiBase: 'https://cf.test' });

    await dns.upsertAddress('s.media.vidalune.com', '2606:4700:4700::1111');
    expect(methods).toEqual(['GET', 'GET', 'DELETE', 'POST']);
  });

  it('deletes only address records when a server is unlinked', async () => {
    const deleted: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/zones?')) return json([{ id: 'zone-1', name: 'vidalune.com' }]);
      if (url.includes('/dns_records?')) return json([
        { id: 'a-1', type: 'A', name: 's.media.vidalune.com', content: '8.8.8.8', proxied: false },
        { id: 'aaaa-1', type: 'AAAA', name: 's.media.vidalune.com', content: '2606:4700:4700::1111', proxied: false },
        { id: 'txt-1', type: 'TXT', name: 's.media.vidalune.com', content: 'verification', proxied: false },
      ]);
      if (init?.method === 'DELETE') deleted.push(url.split('/').at(-1)!);
      return json({ id: url.split('/').at(-1) });
    };
    const dns = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl, apiBase: 'https://cf.test' });

    await dns.deleteAddress('s.media.vidalune.com');
    expect(deleted).toEqual(['a-1', 'aaaa-1']);
  });

  it('creates and removes a DNS-01 TXT record only inside the configured zone', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/zones?')) return json([{ id: 'zone-1', name: 'vidalune.com' }]);
      if (url.includes('/dns_records?')) return json([]);
      return json({ id: 'txt-1' });
    };
    const dns = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl, apiBase: 'https://cf.test' });

    const id = await dns.createTxt('_acme-challenge.server.media.vidalune.com', 'challenge-digest');
    await dns.deleteTxt(id);

    expect(id).toBe('txt-1');
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({ type: 'TXT', name: '_acme-challenge.server.media.vidalune.com', content: 'challenge-digest', ttl: 120 });
    expect(calls[3]).toMatchObject({ url: 'https://cf.test/zones/zone-1/dns_records/txt-1', init: expect.objectContaining({ method: 'DELETE' }) });
  });

  it('removes old TXT challenge values before adding a new one', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.includes('/zones?')) return json([{ id: 'zone-1', name: 'vidalune.com' }]);
      if (url.includes('/dns_records?')) return json([{ id: 'stale-1', type: 'TXT', name: '_acme-challenge.server.media.vidalune.com', content: 'old-challenge', proxied: false }]);
      if (method === 'DELETE') return json({ id: 'stale-1' });
      return json({ id: 'new-challenge' });
    };
    const dns = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl, apiBase: 'https://cf.test' });

    await expect(dns.createTxt('_acme-challenge.server.media.vidalune.com', 'current-challenge')).resolves.toBe('new-challenge');
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET', 'DELETE', 'POST']);
  });

  it('rejects hostnames outside the configured zone and invalid IP addresses without a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const dns = new CloudflareDns({ token: 'test-token', zoneName: 'vidalune.com', fetchImpl });
    await expect(dns.upsertAddress('elsewhere.example', '203.0.113.20')).rejects.toThrow(/outside the configured/);
    await expect(dns.upsertAddress('server.media.vidalune.com', 'not-an-ip')).rejects.toThrow(/valid IP/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports Cloudflare permission failures without exposing the token', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'permission denied' }] }), { status: 403 });
    const dns = new CloudflareDns({ token: 'secret-test-token', zoneName: 'vidalune.com', fetchImpl, apiBase: 'https://cf.test' });
    await expect(dns.upsertAddress('server.media.vidalune.com', '203.0.113.20')).rejects.toThrow(/permission denied/);
    await expect(dns.upsertAddress('server.media.vidalune.com', '203.0.113.20')).rejects.not.toThrow(/secret-test-token/);
  });
});