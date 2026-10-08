import { Resolver } from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import * as acme from 'acme-client';
import type { CloudflareDns } from './cloudflare-dns.js';

type AcmeClient = Pick<acme.Client, 'auto'>;
const DNS_PROPAGATION_TIMEOUT_MS = 30_000;
const DNS_PROPAGATION_POLL_MS = 1_000;

/** Issues one server's publicly trusted certificate without ever receiving its private TLS key. */
export class DirectCertificateIssuer {
  private accountKey: Promise<Buffer> | null = null;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly options: {
      dataDir: string;
      directDomain: string;
      directoryUrl: string;
      email?: string;
      dns: CloudflareDns;
      createClient?: (options: acme.ClientOptions) => AcmeClient;
      resolveNameServerAddresses?: (nameServer: string) => Promise<string[]>;
      resolveTxtAt?: (address: string, name: string) => Promise<string[][]>;
      dnsPropagationTimeoutMs?: number;
      dnsPropagationPollMs?: number;
    },
  ) {}

  issue(hostname: string, csr: string): Promise<string> {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    const domain = this.options.directDomain.toLowerCase().replace(/\.$/, '');
    if (!host.endsWith(`.${domain}`) || host === domain) return Promise.reject(new Error('Certificate hostname is outside the direct-access domain.'));

    const previous = this.queues.get(host) ?? Promise.resolve();
    const current = previous.then(() => this.issueOnce(host, csr));
    const tail = current.then(() => undefined, () => undefined);
    this.queues.set(host, tail);
    return current.finally(() => {
      if (this.queues.get(host) === tail) this.queues.delete(host);
    });
  }

  private async issueOnce(hostname: string, csr: string): Promise<string> {
    const domains = acme.crypto.readCsrDomains(csr);
    const alternateNames = domains.altNames.map((name) => name.toLowerCase());
    if (domains.commonName.toLowerCase() !== hostname || alternateNames.length !== 1 || alternateNames[0] !== hostname) {
      throw new Error('Certificate request must contain only the assigned server hostname.');
    }

    const clientOptions: acme.ClientOptions = { directoryUrl: this.options.directoryUrl, accountKey: await this.getAccountKey() };
    const client = this.options.createClient?.(clientOptions) ?? new acme.Client(clientOptions);
    const txtRecords = new Map<string, string>();
    return client.auto({
      csr,
      ...(this.options.email ? { email: this.options.email } : {}),
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      // For dns-01 acme-client already passes the SHA-256 digest, which is the TXT value itself.
      skipChallengeVerification: true,
      challengeCreateFn: async (authz, challenge, txtValue) => {
        if (challenge.type !== 'dns-01' || authz.identifier.value.toLowerCase() !== hostname) throw new Error('Unexpected ACME challenge for direct server certificate.');
        const recordName = `_acme-challenge.${hostname}`;
        const recordId = await this.options.dns.createTxt(recordName, txtValue);
        txtRecords.set(txtValue, recordId);
        await this.waitForTxt(recordName, txtValue);
      },
      challengeRemoveFn: async (_authz, _challenge, txtValue) => {
        const recordId = txtRecords.get(txtValue);
        if (!recordId) return;
        txtRecords.delete(txtValue);
        await this.options.dns.deleteTxt(recordId);
      },
    });
  }

  private async waitForTxt(name: string, expected: string): Promise<void> {
    const timeoutMs = this.options.dnsPropagationTimeoutMs ?? DNS_PROPAGATION_TIMEOUT_MS;
    const pollMs = this.options.dnsPropagationPollMs ?? DNS_PROPAGATION_POLL_MS;
    const deadline = Date.now() + timeoutMs;
    const nameServers = await this.options.dns.authoritativeNameServers();
    let lastResult: string;
    const errorCode = (err: unknown) => (err as NodeJS.ErrnoException).code ?? 'ERROR';

    while (true) {
      const problems: string[] = [];
      const visible = await Promise.all(nameServers.map(async (nameServer) => {
        try {
          const addresses = await (this.options.resolveNameServerAddresses ?? this.resolveNameServerAddresses.bind(this))(nameServer);
          if (!addresses.length) {
            problems.push(`${nameServer}: no address`);
            return false;
          }
          const answerSets: string[][][] = [];
          await Promise.all(addresses.map(async (address) => {
            try {
              answerSets.push(await (this.options.resolveTxtAt ?? this.resolveTxtAt.bind(this))(address, name));
            } catch (err) {
              // An address we cannot reach (often IPv6 inside Docker) says nothing about the record.
              problems.push(`${address}: ${errorCode(err)}`);
            }
          }));
          return answerSets.length > 0 && answerSets.every((answers) => answers.length > 0 && answers.every((record) => record.join('') === expected));
        } catch (err) {
          problems.push(`${nameServer}: ${errorCode(err)}`);
          return false;
        }
      }));
      const visibleCount = visible.filter(Boolean).length;
      if (visibleCount === nameServers.length) return;
      lastResult = `TXT challenge is visible on ${visibleCount}/${nameServers.length} authoritative Cloudflare nameservers${problems.length ? ` (${problems.join(', ')})` : ''}`;

      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error(`ACME DNS-01 TXT record did not propagate within ${timeoutMs} ms: ${lastResult}.`);
  }

  private async resolveNameServerAddresses(nameServer: string): Promise<string[]> {
    const resolver = new Resolver();
    const [ipv4, ipv6] = await Promise.all([
      resolver.resolve4(nameServer).catch(() => []),
      resolver.resolve6(nameServer).catch(() => []),
    ]);
    return [...ipv4, ...ipv6];
  }

  private resolveTxtAt(address: string, name: string): Promise<string[][]> {
    const resolver = new Resolver();
    resolver.setServers([address]);
    return resolver.resolveTxt(name);
  }

  private accountKeyFile(): string {
    return path.join(this.options.dataDir, 'direct-acme-account.key');
  }

  private async getAccountKey(): Promise<Buffer> {
    this.accountKey ??= this.readOrCreateAccountKey();
    return this.accountKey;
  }

  private async readOrCreateAccountKey(): Promise<Buffer> {
    const file = this.accountKeyFile();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    try {
      return await fs.promises.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const key = await acme.crypto.createPrivateEcdsaKey();
    try {
      await fs.promises.writeFile(file, key, { flag: 'wx', mode: 0o600 });
      return key;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      return fs.promises.readFile(file);
    }
  }
}