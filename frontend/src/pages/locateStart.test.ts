import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCATE_TIMEOUT_MS, locateStart } from './Player';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('finding where a converted stream starts', () => {
  it('uses the keyframe the server finds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ start: 118.4, seek: 118.4 })));
    expect(await locateStart(7, 120)).toEqual({ offset: 118.4, seek: 118.4 });
  });

  it('starts at the asked time itself when the server takes too long (so the spinner does not hang)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))),
    );
    const found = locateStart(7, 120);
    await vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS + 10);
    expect(await found).toEqual({ offset: 120, seek: 120 });
  });
});
