import fs from 'node:fs';
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
  it('binds ACME DNS-01 to the assigned hostname and removes the challenge record', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-acme-'));
    const hostname = 'server-1.media.vidalune.com';
    const [, csr] = await acme.crypto.createCsr({ commonName: hostname, altNames: [hostname] });
    const records: Array<[string, string]> = [];
    const waitForTxt = vi.fn();
    const dns = {
      createTxt: async (name: string, value: string) => { records.push([name, value]); return 'txt-record-1'; },
      waitForTxt,
      deleteTxt: async (id: string) => { records.push(['deleted', id]); },
    } as unknown as CloudflareDns;
    const createClient = vi.fn(() => ({
      auto: async (options: acme.ClientAutoOptions) => {
        const keyAuthorization = 'challenge-token.thumbprint';
        const challenge: Parameters<acme.ClientAutoOptions['challengeCreateFn']>[1] = { type: 'dns-01', url: 'https://acme.example/challenge/1', token: 'challenge-token', status: 'pending' };
        const authorization = { identifier: { type: 'dns', value: hostname } } as acme.Authorization;
        await options.challengeCreateFn(
          authorization,
          challenge,
          keyAuthorization,
        );
        await options.challengeRemoveFn(
          authorization,
          challenge,
          keyAuthorization,
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
    });

    const certificate = await issuer.issue(hostname, csr.toString());
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('challenge-token.thumbprint'));
    const expected = Buffer.from(digest).toString('base64url');
    expect(certificate).toBe('issued certificate chain');
    expect(records).toEqual([['_acme-challenge.server-1.media.vidalune.com', expected], ['deleted', 'txt-record-1']]);
    expect(waitForTxt).not.toHaveBeenCalled();
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