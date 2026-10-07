import { isIP } from 'node:net';
import { resolveTxt } from 'node:dns/promises';

const privateV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const;
const privateV6 = ['::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8', '2001:db8::/32'] as const;

/** Normalizes a proxy-observed address and rejects ranges that must never become public DNS. */
export function publicAddress(input: string): string | null {
  let address = input.trim();
  if (address.toLowerCase().startsWith('::ffff:') && isIP(address.slice(7)) === 4) address = address.slice(7);
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    if (privateV4.some(([network, prefix]) => inV4Subnet(octets, network, prefix))) return null;
    return address;
  }
  if (family === 6 && !privateV6.some((network) => inV6Subnet(address, network))) return address;
  return null;
}

function inV4Subnet(address: number[], network: string, prefix: number): boolean {
  const toNumber = (value: number[]) => value.reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (toNumber(address) & mask) === (toNumber(network.split('.').map(Number)) & mask);
}

function inV6Subnet(address: string, subnet: string): boolean {
  const [network, bitsText] = subnet.split('/');
  const bits = Number(bitsText);
  const expanded = (value: string) => {
    const halves = value.split('::');
    const left = halves[0] ? halves[0]!.split(':') : [];
    const right = halves[1] ? halves[1]!.split(':') : [];
    const missing = 8 - left.length - right.length;
    return [...left, ...Array(Math.max(0, missing)).fill('0'), ...right].map((part) => Number.parseInt(part || '0', 16));
  };
  const addr = expanded(address);
  const base = expanded(network!);
  for (let bit = 0; bit < bits; bit++) {
    const word = Math.floor(bit / 16);
    const offset = 15 - (bit % 16);
    if (((addr[word]! >> offset) & 1) !== ((base[word]! >> offset) & 1)) return false;
  }
  return true;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ message?: string }>;
}

interface Zone {
  id: string;
  name: string;
}

interface DNSRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

interface DNSRecordInput {
  type: 'A' | 'AAAA';
  name: string;
  content: string;
  ttl: number;
  proxied: false;
  comment: string;
}

interface TXTRecordInput {
  type: 'TXT';
  name: string;
  content: string;
  ttl: number;
  comment: string;
}

/** Manages only direct-playback DNS records inside one configured Cloudflare zone. */
export class CloudflareDns {
  private zoneId: Promise<string> | null = null;

  constructor(
    private readonly options: {
      token: string;
      zoneName: string;
      fetchImpl?: typeof fetch;
      apiBase?: string;
      lookupTxt?: (hostname: string) => Promise<string[][]>;
      wait?: (ms: number) => Promise<void>;
    },
  ) {}

  async upsertAddress(hostname: string, address: string): Promise<void> {
    const name = hostname.toLowerCase().replace(/\.$/, '');
    const zone = this.options.zoneName.toLowerCase().replace(/\.$/, '');
    const addressType = isIP(address);
    if (!name.endsWith(`.${zone}`) || name === zone || !/^[a-z0-9.-]+$/.test(name)) throw new Error('Direct hostname is outside the configured Cloudflare zone.');
    if (addressType !== 4 && addressType !== 6) throw new Error('Server address is not a valid IP address.');

    const zoneId = await (this.zoneId ??= this.findZone());
    const type = addressType === 4 ? 'A' : 'AAAA';
    const query = new URLSearchParams({ name });
    const records = await this.request<DNSRecord[]>(`/zones/${zoneId}/dns_records?${query}`);
    if (records.some((record) => record.type !== 'A' && record.type !== 'AAAA')) throw new Error('A conflicting non-address DNS record exists for the direct hostname.');
    const currentType = records.filter((record) => record.type === type);
    if (currentType.length > 1) throw new Error('Multiple matching Cloudflare DNS records exist.');

    for (const stale of records) if (stale.type !== type) await this.deleteRecord(zoneId, stale.id);
    const existing = currentType[0];
    const input: DNSRecordInput = {
      type,
      name,
      content: address,
      ttl: 120,
      proxied: false,
      comment: 'Vidalune direct server access',
    };
    if (existing) {
      if (existing.content === address && existing.proxied === false) return;
      await this.request<DNSRecord>(`/zones/${zoneId}/dns_records/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      return;
    }
    await this.request<DNSRecord>(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteAddress(hostname: string): Promise<void> {
    const name = hostname.toLowerCase().replace(/\.$/, '');
    const zone = this.options.zoneName.toLowerCase().replace(/\.$/, '');
    if (!name.endsWith(`.${zone}`) || name === zone || !/^[a-z0-9.-]+$/.test(name)) throw new Error('Direct hostname is outside the configured Cloudflare zone.');
    const zoneId = await (this.zoneId ??= this.findZone());
    const query = new URLSearchParams({ name });
    const records = await this.request<DNSRecord[]>(`/zones/${zoneId}/dns_records?${query}`);
    for (const record of records) {
      if (record.type === 'A' || record.type === 'AAAA') await this.deleteRecord(zoneId, record.id);
    }
  }

  async createTxt(hostname: string, content: string): Promise<string> {
    const name = hostname.toLowerCase().replace(/\.$/, '');
    const zone = this.options.zoneName.toLowerCase().replace(/\.$/, '');
    if (!name.endsWith(`.${zone}`) || name === zone || !/^[a-z0-9._-]+$/.test(name)) throw new Error('TXT hostname is outside the configured Cloudflare zone.');
    const zoneId = await (this.zoneId ??= this.findZone());
    const query = new URLSearchParams({ type: 'TXT', name });
    const records = await this.request<DNSRecord[]>(`/zones/${zoneId}/dns_records?${query}`);
    const existing = records.find((record) => record.content === content);
    if (existing) return existing.id;
    const input: TXTRecordInput = { type: 'TXT', name, content, ttl: 120, comment: 'Vidalune TLS validation' };
    const created = await this.request<DNSRecord>(`/zones/${zoneId}/dns_records`, { method: 'POST', body: JSON.stringify(input) });
    return created.id;
  }

  async deleteTxt(recordId: string): Promise<void> {
    const zoneId = await (this.zoneId ??= this.findZone());
    await this.deleteRecord(zoneId, recordId);
  }

  async waitForTxt(hostname: string, content: string, attempts = 12): Promise<void> {
    const lookup = this.options.lookupTxt ?? resolveTxt;
    const wait = this.options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const records = await lookup(hostname);
        if (records.some((parts) => parts.join('') === content)) return;
      } catch {
        // DNS-01 TXT propagation is asynchronous; retry until the bounded deadline.
      }
      if (attempt + 1 < attempts) await wait(2500);
    }
    throw new Error('DNS validation record did not become visible before the ACME challenge deadline.');
  }

  private deleteRecord(zoneId: string, recordId: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
  }

  private async findZone(): Promise<string> {
    const query = new URLSearchParams({ name: this.options.zoneName });
    const zones = await this.request<Zone[]>(`/zones?${query}`);
    const zone = zones.find((candidate) => candidate.name.toLowerCase() === this.options.zoneName.toLowerCase());
    if (!zone) throw new Error('Configured Cloudflare zone was not found or the token cannot read it.');
    return zone.id;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await (this.options.fetchImpl ?? fetch)(`${this.options.apiBase ?? 'https://api.cloudflare.com/client/v4'}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null;
    if (!response.ok || !body?.success || body.result === undefined) {
      const reason = body?.errors?.map((error) => error.message).filter(Boolean).join('; ');
      throw new Error(`Cloudflare DNS request failed${reason ? `: ${reason}` : ` (${response.status})`}.`);
    }
    return body.result;
  }
}