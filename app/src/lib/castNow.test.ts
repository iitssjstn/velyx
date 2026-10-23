import { describe, expect, it } from 'vitest';
import { castNow, castNowRoute, castNowShare } from './castNow';

const media = (vidalune: Record<string, unknown>, metadata: Record<string, unknown> = { title: 'Peaky Blinders', subtitle: 'S1 E3', images: [{ url: 'https://s.example/p.jpg?cast=x' }] }) => ({ metadata, customData: { vidalune } });

describe('castNow', () => {
  it('reads what a phone or the website gave the TV', () => {
    const now = castNow(media({ fileId: 7, title: { kind: 'episode', id: 12 }, durationSec: 3600, offset: 0 }));
    expect(now).toEqual({ title: 'Peaky Blinders', subtitle: 'S1 E3', image: 'https://s.example/p.jpg?cast=x', item: { kind: 'episode', id: 12 }, duration: 3600, offset: 0 });
    expect(castNowRoute(now)).toBe('/play/episode/12?tv=1&bar=1');
  });

  it('reads a title the TV started itself', () => {
    expect(castNow(media({ fileId: 8, item: { kind: 'movie', id: 3 } }))?.item).toEqual({ kind: 'movie', id: 3 });
  });

  it('is nothing for media that is not Vidalune', () => {
    expect(castNow(null)).toBeNull();
    expect(castNow({ metadata: { title: 'x' } })).toBeNull();
  });

  it('has no route without a title', () => {
    const now = castNow(media({ fileId: 8 }, {}));
    expect(now?.title).toBe('');
    expect(castNowRoute(now)).toBeNull();
  });

  it('shows how far the title is, from the start of the file', () => {
    const now = castNow(media({ fileId: 1, durationSec: 100, offset: 20 }));
    expect(castNowShare(now, 30)).toBe(0.5);
    expect(castNowShare(now, 500)).toBe(1);
    expect(castNowShare(now, null)).toBe(0);
    expect(castNowShare(castNow(media({ fileId: 1 })), 30)).toBe(0);
  });
});
