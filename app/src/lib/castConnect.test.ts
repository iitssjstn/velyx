import { describe, expect, it } from 'vitest';
import { castConnectData, castConnectRoute, castGiven, castPlayerState, castSubtitleFor, castSubtitleKeys, castThen, castTrackIdsFor } from './castConnect';

const load = (vidalune: Record<string, unknown>, currentTime = 120) => ({ customData: JSON.stringify({ vidalune }), currentTime, activeTrackIds: [] });

describe('casting into the Vidalune app on a Google TV (Cast Connect)', () => {
  it('opens the title in the player where the sender was, with its subtitle and audio', () => {
    expect(castConnectRoute(load({ serverId: 'srv', title: { kind: 'episode', id: 42 }, offset: 600, subtitleKey: 'emb-3', audioIndex: 1 }, 30.6), 'srv')).toBe('/play/episode/42?t=630&cast=1&o=600&sub=emb-3&audio=1');
    // No subtitle on the sender: none here either (not what this TV remembers).
    expect(castConnectRoute(load({ serverId: 'srv', title: { kind: 'movie', id: 7 }, subtitleKey: null }), 'srv')).toBe('/play/movie/7?t=120&cast=1&sub=-');
  });

  it('opens the server first when this TV is on another one (or none)', () => {
    const route = castConnectRoute(load({ serverId: 'other', title: { kind: 'movie', id: 7 } }), 'srv');
    expect(route).toBe(`/cloud?server=other&then=${encodeURIComponent('/play/movie/7?t=120&cast=1')}`);
    expect(castConnectRoute(load({ serverId: 'other', title: { kind: 'movie', id: 7 } }), null)).toBe(route);
    expect(castThen('/play/movie/7?t=120&cast=1')).toBe('/play/movie/7?t=120&cast=1');
  });

  it('ignores casts that are not from Vidalune or name nothing to play', () => {
    expect(castConnectRoute({ customData: null, currentTime: 0, activeTrackIds: [] }, 'srv')).toBeNull();
    expect(castConnectRoute({ customData: '{', currentTime: 0, activeTrackIds: [] }, 'srv')).toBeNull();
    expect(castConnectRoute(load({ serverId: 'srv', title: { kind: 'show', id: 1 } }), 'srv')).toBeNull();
    expect(castConnectRoute(load({ serverId: 'srv', title: { kind: 'movie', id: -1 } }), 'srv')).toBeNull();
    // A server not linked to vidalune.com: this TV cannot open it.
    expect(castConnectRoute(load({ serverId: null, title: { kind: 'movie', id: 7 } }), 'srv')).toBeNull();
    // No odd keys in the route.
    expect(castConnectRoute(load({ serverId: 'srv', title: { kind: 'movie', id: 7 }, subtitleKey: 'a&b' }), 'srv')).toBe('/play/movie/7?t=120&cast=1');
  });

  it('goes on to the player route it made after opening a server', () => {
    const route = castConnectRoute(load({ serverId: 'other', title: { kind: 'episode', id: 42 }, offset: 12.5, subtitleKey: 'ext-4', audioIndex: 0 }), 'srv', 17)!;
    const then = decodeURIComponent(route.split('then=')[1]!);
    expect(castThen(then)).toBe(then);
    expect(castConnectRoute(load({ serverId: 'srv', title: { kind: 'movie', id: 7 } }), 'srv', 17)).toBe('/play/movie/7?t=120&cast=1&n=17');
  });

  it('only goes on to a player route after opening a server', () => {
    for (const bad of [undefined, '', '/home', 'https://evil.example/play/movie/1', '/play/movie/1/../x', '/play/movie/1?x=<script>']) expect(castThen(bad), String(bad)).toBeNull();
  });

  it('numbers subtitles as the cast does, and maps a sender\'s pick back', () => {
    const keys = castSubtitleKeys([{ key: 'emb-1', kind: 'embedded' }, { key: 'img-2', kind: 'image' }, { key: 'ext-5', kind: 'external' }]);
    expect(keys).toEqual(['emb-1', 'ext-5']);
    expect(castTrackIdsFor('ext-5', keys)).toEqual([2]);
    expect(castTrackIdsFor(null, keys)).toEqual([]);
    expect(castTrackIdsFor('img-2', keys)).toEqual([]);
    expect(castSubtitleFor(1, keys)).toBe('emb-1');
    expect(castSubtitleFor(0, keys)).toBeNull();
    expect(castSubtitleFor(9, keys)).toBeUndefined();
  });

  it('tells senders the state, and the title so they follow the next episode', () => {
    expect(castPlayerState({ playing: true, loading: false })).toBe('playing');
    expect(castPlayerState({ playing: false, loading: false })).toBe('paused');
    expect(castPlayerState({ playing: true, loading: true })).toBe('buffering');
    expect(JSON.parse(castConnectData({ kind: 'episode', id: 43, fileId: 9 }, 2))).toEqual({ vidalune: { fileId: 9, audioIndex: 2, item: { kind: 'episode', id: 43 } } });
  });

  it('reads the start the cast gave the player', () => {
    expect(castGiven({ sub: 'emb-3', audio: '1', o: '600' })).toEqual({ subtitleKey: 'emb-3', audioIndex: 1, offset: 600 });
    expect(castGiven({ sub: '-' })).toEqual({ subtitleKey: null, offset: 0 });
    expect(castGiven({ audio: 'x', o: 'y' })).toEqual({ offset: 0 });
  });
});
