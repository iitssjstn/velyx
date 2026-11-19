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

  it('starts at the asked time itself when the server takes too long, and still gives the real start once it comes', async () => {
    vi.useFakeTimers();
    let answer!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    const found = locateStart(7, 120);
    await vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS + 10);
    const r = await found;
    expect({ offset: r.offset, seek: r.seek }).toEqual({ offset: 120, seek: 120 });
    answer(Response.json({ start: 117.2, seek: 120 }));
    expect(await r.late).toBe(117.2);
  });

  it('gives the asked time when the server cannot tell', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    expect(await locateStart(7, 120)).toEqual({ offset: 120, seek: 120 });
  });
});
