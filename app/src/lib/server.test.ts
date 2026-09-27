import { describe, expect, it, vi } from 'vitest';
import { findServer, serverCandidates, ServerError, SUPPORTED_API_VERSION } from './server';

const info = (over: object = {}) => ({ name: 'Thuis', product: 'Vidalune', version: '0.8.1', apiVersion: 1, setupRequired: false, ...over });
const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('server address', () => {
  it('tries HTTPS then HTTP when no scheme is typed, and drops copied page paths', () => {
    expect(serverCandidates(' vidalune.example.com ')).toEqual(['https://vidalune.example.com', 'http://vidalune.example.com']);
    expect(serverCandidates('192.168.1.10:3000')).toEqual(['https://192.168.1.10:3000', 'http://192.168.1.10:3000']);
    expect(serverCandidates('https://vidalune.example.com/movies/12?x=1')).toEqual(['https://vidalune.example.com']);
    expect(serverCandidates('HTTP://Vidalune.local:8080/')).toEqual(['http://vidalune.local:8080']);
  });

  it('refuses what cannot be a server address', () => {
    expect(serverCandidates('')).toEqual([]);
    expect(serverCandidates('two words')).toEqual([]);
    expect(serverCandidates('ftp://vidalune.example.com')).toEqual([]);
  });
});

describe('finding the server', () => {
  it('uses the first address that answers as Vidalune', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://')) throw new Error('no TLS at home');
      return answer(info());
    });
    const found = await findServer('192.168.1.10:3000', fetchImpl);
    expect(found).toEqual({ url: 'http://192.168.1.10:3000', info: info() });
    expect(fetchImpl).toHaveBeenCalledWith('https://192.168.1.10:3000/api/server/info', expect.anything());
  });

  it('explains every way it can go wrong', async () => {
    const problem = async (input: string, fetchImpl: Parameters<typeof findServer>[1]) => {
      try {
        await findServer(input, fetchImpl);
        return 'found';
      } catch (err) {
        return (err as ServerError).problem;
      }
    };
    expect(await problem('bad address!', vi.fn())).toBe('invalid');
    expect(await problem('vidalune.example.com', async () => { throw new Error('offline'); })).toBe('unreachable');
    expect(await problem('vidalune.example.com', async () => answer({ hello: 'world' }))).toBe('not-vidalune');
    expect(await problem('vidalune.example.com', async () => answer({}, 404))).toBe('not-vidalune');
    expect(await problem('vidalune.example.com', async () => answer(info({ apiVersion: undefined })))).toBe('too-old');
    expect(await problem('vidalune.example.com', async () => answer(info({ apiVersion: SUPPORTED_API_VERSION + 1 })))).toBe('too-new');
    expect(await problem('vidalune.example.com', async () => answer(info({ setupRequired: true })))).toBe('setup');
    // Servers from before the rename to Vidalune answer as Velyx.
    expect(await problem('vidalune.example.com', async () => answer(info()))).toBe('found');
    expect(await problem('vidalune.example.com', async () => answer(info({ product: 'Velyx' })))).toBe('found');
  });
});
