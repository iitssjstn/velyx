import { describe, expect, it, vi } from 'vitest';
import { fasterAddresses, findReachable, reconnectOrder } from './reconnect';

describe('finding the server again', () => {
  it('tries the address in use first, then the others, each once', () => {
    expect(reconnectOrder('https://home.example', ['https://home.example', 'https://abc.vidalune.com'])).toEqual(['https://home.example', 'https://abc.vidalune.com']);
    expect(reconnectOrder('https://home.example')).toEqual(['https://home.example']);
  });

  it('takes the first address that answers as a Vidalune server', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://home.example')) throw new TypeError('Network request failed');
      if (url.startsWith('https://captive.example')) return new Response('<html>Log in to the Wi-Fi</html>', { status: 200 });
      return Response.json({ name: 'Thuis', version: '0.18.1' });
    }) as unknown as typeof fetch;
    expect(await findReachable(['https://home.example', 'https://captive.example', 'https://abc.vidalune.com'], fetchImpl)).toBe('https://abc.vidalune.com');
    expect(await findReachable(['https://home.example'], fetchImpl)).toBeNull();
  });

  it('asks all addresses at once: one that hangs does not hold up the rest', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        if (url.startsWith('https://hangs.example')) return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
        return Promise.resolve(Response.json({ name: 'Thuis' }));
      }) as unknown as typeof fetch;
      let found: string | null | undefined;
      void findReachable(['https://hangs.example', 'https://abc.vidalune.com'], fetchImpl, 6000, 1500).then((f) => (found = f));
      await vi.advanceTimersByTimeAsync(1400);
      expect(found).toBeUndefined();
      await vi.advanceTimersByTimeAsync(200);
      expect(found).toBe('https://abc.vidalune.com');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers the earliest address in the list, also when a later one answers sooner', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://lan.example')) await new Promise((r) => setTimeout(r, 30));
      return Response.json({ name: 'Thuis' });
    }) as unknown as typeof fetch;
    expect(await findReachable(['https://lan.example', 'https://abc.vidalune.com'], fetchImpl)).toBe('https://lan.example');
    expect(await findReachable([], fetchImpl)).toBeNull();
  });

  it('knows which addresses are faster than the one in use', () => {
    const list = ['https://192-168-1-5.media.example:32400/', 'https://direct.example:32400', 'https://abc.vidalune.com'];
    expect(fasterAddresses('https://abc.vidalune.com', list)).toEqual(['https://192-168-1-5.media.example:32400', 'https://direct.example:32400']);
    expect(fasterAddresses('https://direct.example:32400', list)).toEqual(['https://192-168-1-5.media.example:32400']);
    expect(fasterAddresses('https://192-168-1-5.media.example:32400', list)).toEqual([]);
    expect(fasterAddresses('https://other.example', list)).toEqual([]);
    expect(fasterAddresses('https://abc.vidalune.com')).toEqual([]);
  });
});
