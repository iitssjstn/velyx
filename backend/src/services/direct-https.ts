import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, randomUUID, X509Certificate } from 'node:crypto';
import * as acme from 'acme-client';
import type { FastifyInstance } from 'fastify';
import type { CloudService } from './cloud.js';
import { castPath } from './cast.js';
import { createLogger } from '../logger.js';

const log = createLogger('direct-https');
const CHECK_MS = 60_000;
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60_000;
const INITIAL_RETRY_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;
const PENDING_POLL_MS = 10_000;
export const DIRECT_HEALTH_PATH = '/api/server/direct/health';
const FORWARDED_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-forwarded-server',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
  'x-cluster-client-ip',
];

/** The account service is still issuing the certificate; not a failure. */
class CertificatePending extends Error {}

/** HTTPS media-only listener on the forwarded TCP port; TLS keys stay in the server data directory. */
export class DirectHttpsService {
  private listener: https.Server | null = null;
  private hostname: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private working: Promise<void> | null = null;
  private retryAt = 0;
  private retryMs = INITIAL_RETRY_MS;

  constructor(
    private readonly options: {
      app: FastifyInstance;
      cloud: CloudService;
      dataDir: string;
      port: number;
      host: string;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), CHECK_MS);
    this.timer.unref();
    void this.refresh();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.timer = null;
    this.pollTimer = null;
    this.listener?.close();
    this.listener = null;
    this.hostname = null;
  }

  refresh(): Promise<void> {
    if ((this.options.now?.() ?? Date.now()) < this.retryAt) return Promise.resolve();
    if (this.working) return this.working;
    this.working = this.refreshOnce().then(() => {
      this.retryAt = 0;
      this.retryMs = INITIAL_RETRY_MS;
    }).catch((err) => {
      if (err instanceof CertificatePending) {
        log.info('Waiting for the Vidalune account service to issue the certificate');
        this.pollTimer = setTimeout(() => void this.refresh(), PENDING_POLL_MS);
        this.pollTimer.unref();
        return;
      }
      this.retryAt = (this.options.now?.() ?? Date.now()) + this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
      log.warn(`Direct HTTPS setup is waiting; retry scheduled: ${(err as Error).message}`);
    }).finally(() => {
      this.working = null;
    });
    return this.working;
  }

  private async refreshOnce(): Promise<void> {
    const access = this.options.cloud.status().directAccess;
    if (!access?.dnsReady) {
      this.listener?.close();
      this.listener = null;
      this.hostname = null;
      this.options.cloud.setDirectTlsReady(false);
      return;
    }

    const keyFile = path.join(this.options.dataDir, 'direct-access', 'tls.key');
    const certFile = path.join(this.options.dataDir, 'direct-access', 'tls.crt');
    const existing = await this.readPair(keyFile, certFile);
    if (existing && this.certificateMatches(existing.certificate, access.hostname) && this.expiresLater(existing.certificate, RENEW_BEFORE_MS)) {
      await this.listen(access.hostname, existing.key, existing.certificate);
      return;
    }

    const privateKey = existing?.key ?? await this.loadOrCreateKey(keyFile);
    const keyId = createHash('sha256').update(createPublicKey(privateKey).export({ type: 'spki', format: 'der' })).digest('hex');
    const [, csr] = await acme.crypto.createCsr({ commonName: access.hostname, altNames: [access.hostname] }, privateKey);
    const issued = await this.options.cloud.directCertificate(csr.toString(), keyId);
    if ('pending' in issued) throw new CertificatePending();
    if (issued.hostname !== access.hostname || !this.certificateMatches(issued.certificate, access.hostname) || !this.matchesKey(issued.certificate, privateKey)) throw new Error('Issued certificate does not match this server hostname and key.');

    await this.atomicWrite(certFile, issued.certificate);
    await this.listen(access.hostname, privateKey, issued.certificate);
  }

  /** The key is kept before the request, so a retry asks for the certificate of the same key. */
  private async loadOrCreateKey(keyFile: string): Promise<Buffer> {
    try {
      return await fs.promises.readFile(keyFile);
    } catch {
      const key = await acme.crypto.createPrivateEcdsaKey();
      await fs.promises.mkdir(path.dirname(keyFile), { recursive: true });
      await this.atomicWrite(keyFile, key);
      return key;
    }
  }

  private matchesKey(certificate: string, key: Buffer): boolean {
    try {
      return new X509Certificate(certificate).checkPrivateKey(createPrivateKey(key));
    } catch {
      return false;
    }
  }

  private async readPair(keyFile: string, certFile: string): Promise<{ key: Buffer; certificate: string } | null> {
    try {
      return { key: await fs.promises.readFile(keyFile), certificate: await fs.promises.readFile(certFile, 'utf8') };
    } catch {
      return null;
    }
  }

  private certificateMatches(certificate: string, hostname: string): boolean {
    try {
      const info = acme.crypto.readCertificateInfo(certificate);
      return info.domains.commonName.toLowerCase() === hostname.toLowerCase() && info.domains.altNames.some((name) => name.toLowerCase() === hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  private expiresLater(certificate: string, period: number): boolean {
    try {
      return acme.crypto.readCertificateInfo(certificate).notAfter.getTime() > (this.options.now?.() ?? Date.now()) + period;
    } catch {
      return false;
    }
  }

  private async atomicWrite(file: string, content: Buffer | string): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    try {
      await fs.promises.rename(temporary, file);
    } catch (err) {
      await fs.promises.rm(temporary, { force: true });
      throw err;
    }
  }

  private async listen(hostname: string, key: Buffer, certificate: string): Promise<void> {
    if (this.listener && this.hostname === hostname) {
      this.listener.setSecureContext({ key, cert: certificate });
      this.options.cloud.setDirectTlsReady(true);
      return;
    }
    this.listener?.close();
    this.listener = null;
    this.hostname = null;
    const server = https.createServer({ key, cert: certificate }, (request, reply) => {
      const host = String(request.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
      if (host !== hostname.toLowerCase()) {
        reply.writeHead(421).end();
        return;
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && request.url?.split('?', 1)[0] === DIRECT_HEALTH_PATH) {
        reply.writeHead(204, { 'Cache-Control': 'no-store' }).end();
        return;
      }
      const directUrl = new URL(request.url ?? '/', `https://${hostname}`);
      if (!directUrl.searchParams.get('cast')) {
        reply.writeHead(401, { 'Cache-Control': 'no-store' }).end();
        return;
      }
      for (const header of FORWARDED_HEADERS) delete request.headers[header];
      delete request.headers.cookie;
      delete request.headers.authorization;
      const target = castPath(directUrl.pathname);
      if (!target || target === 'image') {
        reply.writeHead(404).end();
        return;
      }
      this.options.app.routing(request, reply);
    });
    await new Promise<void>((resolve, reject) => {
      const failed = (err: Error) => {
        server.off('listening', ready);
        server.close();
        reject(err);
      };
      const ready = () => {
        server.off('error', failed);
        resolve();
      };
      server.once('error', failed);
      server.once('listening', ready);
      server.listen(this.options.port, this.options.host);
    });
    server.on('error', (err) => {
      log.error(`Direct HTTPS listener failed on port ${this.options.port}`, err);
      this.options.cloud.setDirectTlsReady(false);
    });
    this.listener = server;
    this.hostname = hostname;
    this.options.cloud.setDirectTlsReady(true);
    log.info(`Direct HTTPS listener started on port ${this.options.port}`);
  }
}