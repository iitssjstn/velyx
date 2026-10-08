import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as acme from 'acme-client';
import { DirectCertificateIssuer } from '../src/direct-certificate.js';
import type { CloudflareDns } from '../src/cloudflare-dns.js';

let dir: string;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('direct server certificates', () => {
  it('publishes the dns-01 value that acme-client hands out without hashing it again', async () => {
    const client = new acme.Client({ directoryUrl: 'https://acme.example/directory', accountKey: await acme.crypto.createPrivateEcdsaKey() });
    const challenge = { type: 'http-01', url: 'https://acme.example/challenge/1', status: 'pending', token: 'token' } as unknown as Parameters<typeof client.getChallengeKeyAuthorization>[0];
    const raw = await client.getChallengeKeyAuthorization(challenge);
    const dns = await client.getChallengeKeyAuthorization({ ...challenge, type: 'dns-01' } as typeof challenge);
    expect(dns).toBe(createHash('sha256').update(raw).digest('base64url'));
  });
  it('binds ACME DNS-01 to the assigned hostname and removes the challenge record', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-acme-'));
    const hostname = 'server-1.media.vidalune.com';
    const [, csr] = await acme.crypto.createCsr({ commonName: hostname, altNames: [hostname] });
    const records: Array<[string, string]> = [];
    let publicQueries = 0;
    const dns = {
      createTxt: async (name: string, value: string) => { records.push([name, value]); return 'txt-record-1'; },
      deleteTxt: async (id: string) => { records.push(['deleted', id]); },
      authoritativeNameServers: async () => ['ns1.cloudflare.test', 'ns2.cloudflare.test'],
    } as unknown as CloudflareDns;
    const createClient = vi.fn(() => ({
      auto: async (options: acme.ClientAutoOptions) => {
        const txtValue = 'dns01-digest-from-acme-client';
        const challenge: Parameters<acme.ClientAutoOptions['challengeCreateFn']>[1] = { type: 'dns-01', url: 'https://acme.example/challenge/1', token: 'challenge-token', status: 'pending' };
        const authorization = { identifier: { type: 'dns', value: hostname } } as acme.Authorization;
        await options.challengeCreateFn(
          authorization,
          challenge,
          txtValue,
        );
        await options.challengeRemoveFn(
          authorization,
          challenge,
          txtValue,
        );
        return 'issued certificate chain';
      },
    }));
    const issuer = new DirectCertificateIssuer({
      dataDir: dir,
      directDomain: 'media.vidalune.com',
      directoryUrl: 'https://acme-staging.example/directory',
      dns,
      createClient,
      resolveNameServerAddresses: async (nameServer) => [nameServer === 'ns1.cloudflare.test' ? '192.0.2.53' : '192.0.2.54', '2001:db8::53'],
      resolveTxtAt: async (address, name) => {
        expect(name).toBe('_acme-challenge.server-1.media.vidalune.com');
        if (address.includes(':')) throw Object.assign(new Error('unreachable'), { code: 'ETIMEOUT' });
        publicQueries += 1;
        return publicQueries > 2 ? [[records[0]![1]]] : [[records[0]![1]], ['stale-challenge']];
      },
      dnsPropagationPollMs: 0,
    });

    const certificate = await issuer.issue(hostname, csr.toString());
    expect(certificate).toBe('issued certificate chain');
    expect(records).toEqual([['_acme-challenge.server-1.media.vidalune.com', 'dns01-digest-from-acme-client'], ['deleted', 'txt-record-1']]);
    expect(publicQueries).toBe(4);
    expect(optionsOf(createClient).directoryUrl).toBe('https://acme-staging.example/directory');
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'direct-acme-account.key')).mode & 0o777).toBe(0o600);
  });

  it('rejects a CSR for any hostname other than the assigned server hostname', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-acme-'));
    const [, csr] = await acme.crypto.createCsr({ commonName: 'other.example', altNames: ['other.example'] });
    const createClient = vi.fn();
    const issuer = new DirectCertificateIssuer({
      dataDir: dir,
      directDomain: 'media.vidalune.com',
      directoryUrl: 'https://acme-staging.example/directory',
      dns: {} as CloudflareDns,
      createClient,
    });
    await expect(issuer.issue('server-1.media.vidalune.com', csr.toString())).rejects.toThrow(/assigned server hostname/);
    expect(createClient).not.toHaveBeenCalled();
  });
});

function optionsOf(mock: ReturnType<typeof vi.fn>): acme.ClientOptions {
  return mock.mock.calls[0]?.[0] as acme.ClientOptions;
}