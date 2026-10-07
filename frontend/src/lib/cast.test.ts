import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { castBase, castTextTrackStyle, castUrl } from './cast';

describe('cast addresses', () => {
  const s = { serverUrl: 'http://192.168.1.10:3000/' };
  it('uses the configured server address, never the relay, when casting from the account site', () => {
    expect(castBase('http://192.168.1.10:3000', s)).toBe('http://192.168.1.10:3000');
    expect(castBase('https://app.vidalune.com', s)).toBe('http://192.168.1.10:3000');
    expect(castBase('http://localhost:5173', s)).toBe('http://192.168.1.10:3000');
    expect(castBase('https://app.vidalune.com', { serverUrl: null })).toBe('https://app.vidalune.com');
  });

  it('carry the token, and a start for repackaged streams', () => {
    expect(castUrl('http://nas:3000', '/api/media/5/stream', 'tok.en')).toBe('http://nas:3000/api/media/5/stream?cast=tok.en');
    expect(castUrl('http://nas:3000', '/api/media/5/remux?audio=aac', 'tok', 61.5)).toBe('http://nas:3000/api/media/5/remux?audio=aac&start=61.500&cast=tok');
  });
});

describe('Cast subtitle style', () => {
  it('maps saved preferences to readable receiver settings', () => {
    expect(castTextTrackStyle({ subtitleSize: 'large', subtitleColor: 'yellow', subtitleBackground: 'none', subtitleEdge: 'outline' })).toEqual({
      fontFamily: 'sans-serif',
      fontGenericFamily: 'SANS_SERIF',
      fontScale: 1.2,
      foregroundColor: '#FFE14DFF',
      backgroundColor: '#00000000',
      edgeType: 'OUTLINE',
      edgeColor: '#000000FF',
    });
  });
});

/* A tiny stand-in for Google's Cast SDK: one device, one session, a remote player. */
function fakeSdk() {
  const loaded: Array<{ url: string; type: string; currentTime: number; tracks: Array<{ trackContentId: string }>; active: number[]; textTrackStyle: unknown }> = [];
  const listeners = new Map<string, () => void>();
  const remote = { currentTime: 0, isPaused: false, isConnected: true };
  const session = {
    loadMedia: vi.fn(async (req: { media: { contentId: string; contentType: string; tracks: Array<{ trackContentId: string }>; textTrackStyle: unknown }; currentTime: number; activeTrackIds: number[] }) => {
      loaded.push({ url: req.media.contentId, type: req.media.contentType, currentTime: req.currentTime, tracks: req.media.tracks, active: req.activeTrackIds, textTrackStyle: req.media.textTrackStyle });
    }),
    getCastDevice: () => ({ friendlyName: 'Woonkamer' }),
  };
  let current: typeof session | null = null;
  const context = {
    setOptions: vi.fn(),
    getCastState: () => 'NOT_CONNECTED',
    addEventListener: vi.fn(),
    getCurrentSession: () => current,
    requestSession: vi.fn(async () => {
      current = session;
    }),
    endCurrentSession: vi.fn(() => {
      current = null;
    }),
  };
  const controller = { addEventListener: (type: string, cb: () => void) => listeners.set(type, cb), playOrPause: vi.fn(), seek: vi.fn() };
  class Obj {
    [k: string]: unknown;
    constructor(...args: unknown[]) {
      Object.assign(this, { args });
    }
  }
  const framework = {
    CastContext: { getInstance: () => context },
    CastState: { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE' },
    CastContextEventType: { CAST_STATE_CHANGED: 'caststatechanged' },
    RemotePlayer: function RemotePlayer() {
      return remote;
    },
    RemotePlayerController: function RemotePlayerController() {
      return controller;
    },
    RemotePlayerEventType: { CURRENT_TIME_CHANGED: 'time', IS_PAUSED_CHANGED: 'paused', IS_CONNECTED_CHANGED: 'connected' },
  };
  const chrome = {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' },
      Image: Obj,
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
        MediaInfo: function MediaInfo(this: Record<string, unknown>, contentId: string, contentType: string) {
          this.contentId = contentId;
          this.contentType = contentType;
        },
        TextTrackStyle: Obj,
        StreamType: { BUFFERED: 'BUFFERED' },
        GenericMediaMetadata: Obj,
        Track: function Track(this: Record<string, unknown>, id: number) {
          this.trackId = id;
        },
        TrackType: { TEXT: 'TEXT' },
        TextTrackType: { SUBTITLES: 'SUBTITLES' },
        LoadRequest: function LoadRequest(this: Record<string, unknown>, media: unknown) {
          this.media = media;
        },
      },
    },
  };
  return { framework, chrome, loaded, context, controller, remote, listeners };
}

describe('casting from the player', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('continues on the TV where the page was, with the token, subtitles and a start for repackaged streams', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    vi.stubGlobal('chrome', sdk.chrome);
    // The SDK "loads" as soon as its script is added to the page.
    const append = document.head.append.bind(document.head);
    vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      const script = nodes[0] as HTMLScriptElement;
      if (script instanceof HTMLScriptElement && script.src.includes('gstatic')) {
        (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
        setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
        return;
      }
      append(...nodes);
    });
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(
          JSON.stringify({ token: 'tok', expiresAt: Date.now() + 3_600_000, relayUrl: null, serverUrl: null, contentType: 'video/mp4', decision: { engine: 'remux', streamUrl: '/api/media/5/remux?audio=aac', seek: 'restart', durationSec: 3000 }, subtitles: [{ key: 'emb-3', label: 'Nederlands', language: 'nl', url: '/api/media/5/subtitles/3.vtt' }] }),
          { status: 200 },
        );
      }),
    );
    const { useCast } = await import('./cast');
    const locate = vi.fn(async (t: number) => ({ offset: t - 2, seek: t - 2 }));
    const { result } = renderHook(() => useCast({ fileId: 5, audioIndex: 1, title: 'Dune', subtitle: '2021', posterPath: '/back.jpg', subtitleKey: 'emb-3', subtitleStyle: { subtitleSize: 'large', subtitleColor: 'yellow', subtitleBackground: 'none', subtitleEdge: 'shadow' }, locate }));
    await waitFor(() => expect(sdk.context.setOptions).toHaveBeenCalled());
    await act(() => result.current.start(600));
    expect(posts[0]).toMatchObject({ url: '/api/cast/session', body: { fileId: 5, audioIndex: 1 } });
    expect(locate).toHaveBeenCalledWith(600);
    expect(sdk.loaded[0]).toMatchObject({ url: `${location.origin}/api/media/5/remux?audio=aac&start=598.000&cast=tok`, type: 'video/mp4', currentTime: 2, active: [1] });
    expect(sdk.loaded[0].tracks[0].trackContentId).toBe(`${location.origin}/api/media/5/subtitles/3.vtt?offset=598.000&cast=tok`);
    expect(sdk.loaded[0].textTrackStyle).toMatchObject({ fontFamily: 'sans-serif', fontScale: 1.2, foregroundColor: '#FFE14DFF', backgroundColor: '#00000000', edgeType: 'DROP_SHADOW' });
    expect(result.current).toMatchObject({ active: true, device: 'Woonkamer', time: 600 });

    // The TV's position counts from where its stream started.
    sdk.remote.currentTime = 10;
    act(() => sdk.listeners.get('time')!());
    expect(result.current.time).toBe(608);
    // Seeking a repackaged stream loads it again from there.
    await act(async () => result.current.seek(1200));
    await waitFor(() => expect(sdk.loaded).toHaveLength(2));
    expect(sdk.loaded[1].url).toContain('start=1198.000');
    act(() => result.current.togglePlay());
    expect(sdk.controller.playOrPause).toHaveBeenCalled();
    act(() => result.current.stop());
    expect(result.current.active).toBe(false);
  });
});
