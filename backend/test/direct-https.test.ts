import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DirectHttpsService, servesDirect } from '../src/services/direct-https.js';
import type { CloudService } from '../src/services/cloud.js';

let dir: string;
let service: DirectHttpsService | undefined;
afterEach(() => {
  service?.stop();
  service = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('direct HTTPS certificate request', () => {
  it('keeps its key and asks again for the same key while the certificate is pending', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-direct-https-'));
    const requests: string[] = [];
    const cloud = {
      status: () => ({ directAccess: { dnsReady: true, hostname: 'server.media.example.com' } }),
      directCertificate: vi.fn(async (_csr: string, keyId: string) => {
        requests.push(keyId);
        return { pending: true as const };
      }),
      setDirectTlsReady: vi.fn(),
    } as unknown as CloudService;
    service = new DirectHttpsService({ app: {} as FastifyInstance, cloud, dataDir: dir, port: 0, host: '127.0.0.1' });

    await service.refresh();
    await service.refresh();

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(requests[1]).toBe(requests[0]);
    expect(fs.existsSync(path.join(dir, 'direct-access', 'tls.key'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'direct-access', 'tls.crt'))).toBe(false);
  });
});

describe('what the direct port answers', () => {
  it('serves what a cast opens, also the poster the TV shows, and nothing else', () => {
    expect(servesDirect('/api/media/3/hls/index.m3u8')).toBe(true);
    expect(servesDirect('/api/subtitles/4.vtt')).toBe(true);
    expect(servesDirect('/api/images/w342/abc.jpg')).toBe(true);
    expect(servesDirect('/api/cast/progress')).toBe(true);
    expect(servesDirect('/api/movies/3')).toBe(false);
    expect(servesDirect('/api/auth/login')).toBe(false);
  });
});
