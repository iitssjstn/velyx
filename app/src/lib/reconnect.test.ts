import { describe, expect, it, vi } from 'vitest';
import { findReachable, reconnectOrder } from './reconnect';

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
});
