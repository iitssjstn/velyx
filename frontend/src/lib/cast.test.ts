import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { applyCastSubtitleStyle, castBase, castTextTrackStyle, castUrl } from './cast';

describe('cast addresses', () => {
  const s = { directUrl: 'https://server.media.vidalune.com:32400', serverUrl: 'http://192.168.1.10:3000/' };
  it('uses the managed direct hostname for media and never the account site as a fallback', () => {
    expect(castBase('http://192.168.1.10:3000', s)).toBe('https://server.media.vidalune.com:32400');
    expect(castBase('https://app.vidalune.com', s)).toBe('https://server.media.vidalune.com:32400');
    expect(castBase('http://localhost:5173', s)).toBe('https://server.media.vidalune.com:32400');
    expect(castBase('https://app.vidalune.com', { directUrl: null, serverUrl: null })).toBeNull();
  });

  it('carry the token, and a start for repackaged streams', () => {
    expect(castUrl('http://nas:3000', '/api/media/5/stream', 'tok.en')).toBe('http://nas:3000/api/media/5/stream?cast=tok.en');
    expect(castUrl('http://nas:3000', '/api/media/5/remux?audio=aac', 'tok', 61.5)).toBe('http://nas:3000/api/media/5/remux?audio=aac&start=61.500&cast=tok');
  });
});

describe('Cast subtitle style', () => {
  it('uses a high-contrast TV default and validates unsupported saved values', () => {
    expect(castTextTrackStyle()).toMatchObject({ fontScale: 1, foregroundColor: '#FFFFFFFF', backgroundColor: '#00000099', edgeType: 'OUTLINE' });
    expect(castTextTrackStyle({ subtitleSize: 'invalid', subtitleColor: 'pink', subtitleBackground: 'bad', subtitleEdge: 'bad' } as never)).toMatchObject({ fontScale: 1, foregroundColor: '#FFFFFFFF', backgroundColor: '#00000001', edgeType: 'DROP_SHADOW' });
  });
  it('falls back to the TV preset when a receiver rejects a custom style', async () => {
    const apply = vi.fn().mockRejectedValueOnce(new Error('Unsupported')).mockResolvedValueOnce(undefined);
    await applyCastSubtitleStyle({ subtitleSize: 'large', subtitleColor: 'yellow', subtitleBackground: 'none', subtitleEdge: 'none' }, apply);
    expect(apply).toHaveBeenNthCalledWith(2, castTextTrackStyle());
    const failed = vi.fn().mockRejectedValue(new Error('Disconnected'));
    await expect(applyCastSubtitleStyle(undefined, failed)).rejects.toThrow('Disconnected');
  });
  it('maps saved preferences to readable receiver settings', () => {
    expect(castTextTrackStyle({ subtitleSize: 'large', subtitleColor: 'yellow', subtitleBackground: 'none', subtitleEdge: 'outline' })).toEqual({
      fontFamily: 'sans-serif',
      fontGenericFamily: 'SANS_SERIF',
      fontScale: 1.2,
      foregroundColor: '#FFE14DFF',
      backgroundColor: '#00000001',
      edgeType: 'OUTLINE',
      edgeColor: '#000000FF',
    });
  });
});

/* A tiny stand-in for Google's Cast SDK: one device, one session, a remote player. */
function fakeSdk() {
  const loaded: Array<{ url: string; type: string; currentTime: number; tracks: Array<{ trackContentId: string }>; active: number[]; textTrackStyle: unknown; customData: unknown }> = [];
  const listeners = new Map<string, () => void>();
  const remote = { currentTime: 0, isPaused: false, isConnected: true, activeTrackIds: [] as number[], mediaInfo: null as unknown };
  const session = {
    getMediaSession: () => mediaSession,
    loadMedia: vi.fn(async (req: { media: { contentId: string; contentType: string; tracks: Array<{ trackContentId: string }>; textTrackStyle: unknown; customData?: unknown }; currentTime: number; activeTrackIds: number[] }) => {
      loaded.push({ url: req.media.contentId, type: req.media.contentType, currentTime: req.currentTime, tracks: req.media.tracks, active: req.activeTrackIds, textTrackStyle: req.media.textTrackStyle, customData: req.media.customData });
    }),
    getCastDevice: () => ({ friendlyName: 'Woonkamer' }),
  };
  const applied: unknown[] = [];
  const mediaSession = {
    activeTrackIds: undefined as number[] | undefined,
    editTracksInfo: vi.fn((request: { textTrackStyle: unknown }, success: () => void, failure: (error: unknown) => void) => {
      if (!request.textTrackStyle) failure(new Error('Missing style'));
      else { applied.push(request.textTrackStyle); success(); }
    }),
  };
  let current: typeof session | null = null;
  const context = {
    setOptions: vi.fn(),
    getCastState: () => 'NOT_CONNECTED',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getCurrentSession: () => current,
    requestSession: vi.fn(async () => {
      current = session;
    }),
    endCurrentSession: vi.fn(() => {
      current = null;
    }),
  };
  const controller = { addEventListener: (type: string, cb: () => void) => listeners.set(type, cb), removeEventListener: vi.fn((type: string) => listeners.delete(type)), playOrPause: vi.fn(), seek: vi.fn(), setActiveTrackIds: vi.fn() };
  class Obj {
    [k: string]: unknown;
    constructor(...args: unknown[]) {
      Object.assign(this, { args });
    }
  }
  const framework = {
    CastContext: { getInstance: () => context },
    CastState: { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', CONNECTING: 'CONNECTING' },
    CastContextEventType: { CAST_STATE_CHANGED: 'caststatechanged' },
    RemotePlayer: function RemotePlayer() {
      return remote;
    },
    RemotePlayerController: function RemotePlayerController() {
      return controller;
    },
    RemotePlayerEventType: { CURRENT_TIME_CHANGED: 'time', MEDIA_INFO_CHANGED: 'media', IS_PAUSED_CHANGED: 'paused', IS_CONNECTED_CHANGED: 'connected', VOLUME_LEVEL_CHANGED: 'volume', IS_MUTED_CHANGED: 'muted' },
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
        EditTracksInfoRequest: Obj,
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
  return { framework, chrome, loaded, context, controller, remote, listeners, applied, mediaSession };
}

describe('casting from the player', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes over successful playback even when the receiver rejects both subtitle styles', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    vi.stubGlobal('chrome', sdk.chrome);
    vi.spyOn(document.head, 'append').mockImplementation(() => {
      (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
      setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      token: 'tok', expiresAt: Date.now() + 3_600_000, directUrl: null, serverUrl: null, contentType: 'video/mp4',
      decision: { engine: 'direct', streamUrl: '/api/media/5/stream', seek: 'range', durationSec: 3000 }, subtitles: [],
    }), { status: 200 })));
    sdk.mediaSession.editTracksInfo.mockImplementation((_request, _success, failure) => failure(new Error('Style unsupported')));
    const { useCast } = await import('./cast');
    const { result, unmount } = renderHook(() => useCast({ fileId: 5, audioIndex: null, title: 'Dune', subtitleKey: null, locate: async () => ({ offset: 0, seek: 0 }) }));
    await waitFor(() => expect(sdk.context.setOptions).toHaveBeenCalled());
    await act(() => result.current.start(0));
    expect(sdk.loaded).toHaveLength(1);
    expect(result.current).toMatchObject({ active: true, playing: true, device: 'Woonkamer', error: 'Style unsupported' });
    unmount();
  });

  it('shows the button before a Chromecast was found, and says so when there is none', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    (sdk.context as { getCastState: () => string }).getCastState = () => 'NO_DEVICES_AVAILABLE';
    sdk.context.requestSession.mockRejectedValue('receiver_unavailable');
    vi.stubGlobal('chrome', sdk.chrome);
    vi.spyOn(document.head, 'append').mockImplementation(() => {
      (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
      setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
    });
    const { useCast } = await import('./cast');
    const { result, unmount } = renderHook(() => useCast({ fileId: 5, audioIndex: null, title: 'Dune', subtitleKey: null, locate: async () => ({ offset: 0, seek: 0 }) }));
    expect(result.current.supported).toBe(false);
    await waitFor(() => expect(result.current.supported).toBe(true));
    expect(result.current.available).toBe(false);
    await act(() => result.current.start(0));
    expect(sdk.context.requestSession).toHaveBeenCalled();
    expect(result.current).toMatchObject({ active: false, error: 'no Chromecast found on this network' });
    unmount();
  });

  it('says it is connecting from picking a Chromecast until the TV has the title', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    vi.stubGlobal('chrome', sdk.chrome);
    vi.spyOn(document.head, 'append').mockImplementation(() => {
      (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
      setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
    });
    let answer: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    const { useCast } = await import('./cast');
    const { result, unmount } = renderHook(() => useCast({ fileId: 5, audioIndex: null, title: 'Dune', subtitleKey: null, locate: async () => ({ offset: 0, seek: 0 }) }));
    await waitFor(() => expect(result.current.supported).toBe(true));
    expect(result.current.connecting).toBe(false);
    let started: Promise<void> = Promise.resolve();
    act(() => { started = result.current.start(0); });
    await waitFor(() => expect(result.current.connecting).toBe(true));
    answer(new Response(JSON.stringify({ token: 'tok', expiresAt: Date.now() + 3_600_000, directUrl: null, serverUrl: null, contentType: 'video/mp4', decision: { engine: 'direct', streamUrl: '/api/media/5/stream', seek: 'range', durationSec: 3000 }, subtitles: [] }), { status: 200 }));
    await act(() => started);
    expect(result.current).toMatchObject({ connecting: false, active: true });
    unmount();
  });

  it('counts the TV as settled only once it got to the resume point', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    vi.stubGlobal('chrome', sdk.chrome);
    vi.spyOn(document.head, 'append').mockImplementation(() => {
      (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
      setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      token: 'tok', expiresAt: Date.now() + 3_600_000, directUrl: null, serverUrl: null, contentType: 'application/vnd.apple.mpegurl',
      decision: { engine: 'remux', streamUrl: '/api/media/5/hls/index.m3u8', seek: 'range', durationSec: 6000 }, subtitles: [],
    }), { status: 200 })));
    const { useCast } = await import('./cast');
    const { result, unmount } = renderHook(() => useCast({ fileId: 5, audioIndex: null, title: 'Dune', subtitleKey: null, locate: async () => ({ offset: 0, seek: 0 }) }));
    await waitFor(() => expect(result.current.supported).toBe(true));
    await act(() => result.current.start(2700));
    expect(result.current.settled).toBe(false);
    // The TV begins at the start of the stream for a moment: not there yet.
    sdk.remote.currentTime = 4;
    act(() => sdk.listeners.get('time')?.());
    expect(result.current).toMatchObject({ time: 4, settled: false });
    // At the resume point (a keyframe just before it counts too).
    sdk.remote.currentTime = 2692;
    act(() => sdk.listeners.get('time')?.());
    expect(result.current.settled).toBe(true);
    // Seeking back afterwards is the viewer's choice: still settled.
    sdk.remote.currentTime = 30;
    act(() => sdk.listeners.get('time')?.());
    expect(result.current).toMatchObject({ time: 30, settled: true });
    unmount();
  });

  it('says no Chromecast was found when Chrome answers session_error without any', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    (sdk.context as { getCastState: () => string }).getCastState = () => 'NO_DEVICES_AVAILABLE';
    sdk.context.requestSession.mockRejectedValue('session_error');
    vi.stubGlobal('chrome', sdk.chrome);
    vi.spyOn(document.head, 'append').mockImplementation(() => {
      (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
      setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
    });
    const { useCast } = await import('./cast');
    const { result, unmount } = renderHook(() => useCast({ fileId: 5, audioIndex: null, title: 'Dune', subtitleKey: null, locate: async () => ({ offset: 0, seek: 0 }) }));
    await waitFor(() => expect(result.current.supported).toBe(true));
    await act(() => result.current.start(0));
    expect(result.current).toMatchObject({ connecting: false, error: 'no Chromecast found on this network' });
    unmount();
  });

  it('gets a new cast session for another file (the next episode) and says which file the TV has', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    vi.stubGlobal('chrome', sdk.chrome);
    vi.spyOn(document.head, 'append').mockImplementation(() => {
      (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
      setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
    });
    const sessions: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const { fileId } = JSON.parse(String(init?.body)) as { fileId: number };
      sessions.push(fileId);
      return new Response(JSON.stringify({
        token: `tok${fileId}`, expiresAt: Date.now() + 3_600_000, directUrl: null, serverUrl: null, contentType: 'video/mp4',
        decision: { engine: 'direct', streamUrl: `/api/media/${fileId}/stream`, seek: 'range', durationSec: 2500 }, subtitles: [],
      }), { status: 200 });
    }));
    const { useCast } = await import('./cast');
    const { result, rerender, unmount } = renderHook(({ fileId }: { fileId: number }) => useCast({ fileId, audioIndex: null, title: 'Show', subtitleKey: null, locate: async () => ({ offset: 0, seek: 0 }) }), { initialProps: { fileId: 5 } });
    await waitFor(() => expect(sdk.context.setOptions).toHaveBeenCalled());
    await act(() => result.current.start(2400));
    expect(result.current.fileId).toBe(5);
    // The next episode opens on the page: the TV is still on episode 5 until it is given episode 6.
    rerender({ fileId: 6 });
    expect(result.current).toMatchObject({ active: true, fileId: 5 });
    await act(() => result.current.reload(0));
    expect(sessions).toEqual([5, 6]);
    expect(sdk.loaded.at(-1)).toMatchObject({ url: `${location.origin}/api/media/6/stream?cast=tok6`, currentTime: 0 });
    // Vidalune's own cast player, which saves the TV's progress for the file it was given.
    expect(sdk.context.setOptions).toHaveBeenCalledWith(expect.objectContaining({ receiverApplicationId: '920BF057' }));
    expect(sdk.loaded.at(-1)?.customData).toEqual({ vidalune: { progressUrl: `${location.origin}/api/cast/progress?cast=tok6`, offset: 0, durationSec: 2500, fileId: 6, audioIndex: null } });
    expect(result.current).toMatchObject({ active: true, fileId: 6, time: 0 });
    unmount();
  });

  it('follows a title the TV started itself, and a subtitle chosen on the TV', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    vi.stubGlobal('chrome', sdk.chrome);
    vi.spyOn(document.head, 'append').mockImplementation(() => {
      (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
      setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
    });
    const sessions: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const { fileId } = JSON.parse(String(init?.body)) as { fileId: number };
      sessions.push(fileId);
      return new Response(JSON.stringify({
        token: `tok${fileId}`, expiresAt: Date.now() + 3_600_000, directUrl: null, serverUrl: null, contentType: 'video/mp4',
        decision: { engine: 'direct', streamUrl: `/api/media/${fileId}/stream`, seek: 'range', durationSec: 2500 },
        subtitles: [{ key: `e${fileId}`, label: 'English', language: 'en', url: '/s/1', kind: 'external' }, { key: `n${fileId}`, label: 'Nederlands', language: 'nl', url: '/s/2', kind: 'external' }],
      }), { status: 200 });
    }));
    const { useCast } = await import('./cast');
    const { result, rerender, unmount } = renderHook(({ fileId }: { fileId: number }) => useCast({ fileId, audioIndex: null, title: 'Show', subtitleKey: 'e5', locate: async () => ({ offset: 0, seek: 0 }) }), { initialProps: { fileId: 5 } });
    await waitFor(() => expect(sdk.context.setOptions).toHaveBeenCalled());
    await act(() => result.current.start(100));
    const tick = () => act(() => sdk.listeners.get('time')!());
    // The TV still reports the old subtitle right after the page asked for one: the page's choice stands.
    sdk.remote.mediaInfo = { customData: { vidalune: { fileId: 5 } } };
    sdk.mediaSession.activeTrackIds = [];
    await tick();
    expect(result.current.tvSubtitleKey).toBe('e5');
    // Later, Nederlands is chosen with the TV's remote.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    sdk.mediaSession.activeTrackIds = [2];
    await tick();
    expect(result.current.tvSubtitleKey).toBe('n5');
    // The TV starts the next episode itself: the page is told which, and gets its subtitles.
    sdk.remote.mediaInfo = { customData: { vidalune: { fileId: 6, item: { kind: 'episode', id: 42 } } } };
    sdk.mediaSession.activeTrackIds = [1];
    await act(() => sdk.listeners.get('media')!());
    expect(result.current).toMatchObject({ fileId: 6, tvItem: { kind: 'episode', id: 42, fileId: 6 } });
    await waitFor(() => expect(sessions).toEqual([5, 6]));
    await tick();
    expect(result.current.tvSubtitleKey).toBe('e6');
    // The page caught up: it leads again, and nothing was loaded on the TV for it.
    rerender({ fileId: 6 });
    await waitFor(() => expect(result.current.tvItem).toBeNull());
    expect(sdk.loaded).toHaveLength(1);
    // Its subtitle and seeks still reach the TV.
    act(() => result.current.setSubtitle('n6'));
    expect(sdk.remote.activeTrackIds).toEqual([2]);
    act(() => result.current.seek(300));
    expect(sdk.controller.seek).toHaveBeenCalled();
    vi.restoreAllMocks();
    unmount();
  });

  it('lets only the latest of quick seeks reach the TV, whichever keyframe answer comes first', async () => {
    vi.resetModules();
    const sdk = fakeSdk();
    vi.stubGlobal('chrome', sdk.chrome);
    vi.spyOn(document.head, 'append').mockImplementation(() => {
      (window as unknown as { cast: unknown }).cast = { framework: sdk.framework };
      setTimeout(() => (window as unknown as { __onGCastApiAvailable: (ok: boolean) => void }).__onGCastApiAvailable(true));
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      token: 'tok', expiresAt: Date.now() + 3_600_000, directUrl: null, serverUrl: null, contentType: 'video/mp4',
      decision: { engine: 'remux', streamUrl: '/api/media/5/remux?audio=1', seek: 'restart', durationSec: 3000 }, subtitles: [],
    }), { status: 200 })));
    const { useCast } = await import('./cast');
    // The keyframe for the first seek answers late, the one for the second at once.
    const pending: Array<() => void> = [];
    const locate = vi.fn((t: number) => new Promise<{ offset: number; seek: number }>((resolve) => {
      if (t === 600) pending.push(() => resolve({ offset: 598, seek: 598 }));
      else resolve({ offset: t, seek: t });
    }));
    const { result, unmount } = renderHook(() => useCast({ fileId: 5, audioIndex: 1, title: 'Dune', subtitleKey: null, locate }));
    await waitFor(() => expect(sdk.context.setOptions).toHaveBeenCalled());
    await act(() => result.current.start(0));
    act(() => result.current.seek(600));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => result.current.seek(1200));
    await waitFor(() => expect(sdk.loaded.at(-1)?.url).toContain('start=1200.000'));
    await act(async () => pending[0]!());
    await new Promise((r) => setTimeout(r, 20));
    expect(sdk.loaded.at(-1)?.url).toContain('start=1200.000');
    expect(sdk.loaded.some((l: { url: string }) => l.url.includes('start=598.000'))).toBe(false);
    unmount();
  });

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
    const { result, unmount, rerender } = renderHook(({ color }: { color: 'white' | 'yellow' }) => useCast({ fileId: 5, audioIndex: 1, title: 'Dune', subtitle: '2021', posterPath: '/back.jpg', subtitleKey: 'emb-3', subtitleStyle: { subtitleSize: 'large', subtitleColor: color, subtitleBackground: 'none', subtitleEdge: 'shadow' }, locate }), { initialProps: { color: 'yellow' } });
    await waitFor(() => expect(sdk.context.setOptions).toHaveBeenCalled());
    await act(() => result.current.start(600));
    expect(posts[0]).toMatchObject({ url: '/api/cast/session', body: { fileId: 5, audioIndex: 1 } });
    expect(locate).toHaveBeenCalledWith(600);
    expect(sdk.loaded[0]).toMatchObject({ url: `${location.origin}/api/media/5/remux?audio=aac&start=598.000&cast=tok`, type: 'video/mp4', currentTime: 2, active: [1] });
    expect(sdk.loaded[0].tracks[0].trackContentId).toBe(`${location.origin}/api/media/5/subtitles/3.vtt?offset=598.000&cast=tok`);
    expect(sdk.loaded[0].textTrackStyle).toMatchObject({ fontScale: 1, foregroundColor: '#FFFFFFFF', backgroundColor: '#00000099', edgeType: 'OUTLINE' });
    expect(sdk.applied.at(-1)).toMatchObject({ fontScale: 1.2, foregroundColor: '#FFE14DFF', backgroundColor: '#00000001', edgeType: 'DROP_SHADOW' });
    rerender({ color: 'white' });
    await waitFor(() => expect(sdk.applied.at(-1)).toMatchObject({ foregroundColor: '#FFFFFFFF' }));
    expect(sdk.loaded).toHaveLength(1);
    let finishStyle!: () => void;
    sdk.mediaSession.editTracksInfo.mockImplementationOnce((request, success) => {
      finishStyle = () => { sdk.applied.push(request.textTrackStyle); success(); };
    });
    rerender({ color: 'yellow' });
    await waitFor(() => expect(finishStyle).toBeTypeOf('function'));
    rerender({ color: 'white' });
    await act(async () => { finishStyle(); });
    await waitFor(() => expect(sdk.applied.at(-1)).toMatchObject({ foregroundColor: '#FFFFFFFF' }));
    expect(result.current).toMatchObject({ active: true, device: 'Woonkamer', time: 600 });

    // The TV's position counts from where its stream started.
    sdk.remote.currentTime = 10;
    act(() => sdk.listeners.get('time')!());
    expect(result.current.time).toBe(608);
    // Seeking a repackaged stream loads it again from there.
    act(() => result.current.setSubtitle(null));
    await act(async () => result.current.seek(1200));
    await waitFor(() => expect(sdk.loaded).toHaveLength(2));
    expect(sdk.loaded[1].url).toContain('start=1198.000');
    expect(sdk.loaded[1].active).toEqual([]);
    expect(sdk.loaded[1].tracks[0].trackContentId).toContain('offset=1198.000');
    let located!: (result: { offset: number; seek: number }) => void;
    locate.mockImplementationOnce(() => new Promise((resolve) => { located = resolve; }));
    act(() => result.current.seek(1500));
    act(() => result.current.setSubtitle('emb-3'));
    await act(async () => located({ offset: 1498, seek: 1498 }));
    await waitFor(() => expect(sdk.loaded).toHaveLength(3));
    expect(sdk.loaded[2].active).toEqual([1]);
    const castSession = sdk.context.getCurrentSession()!;
    const loadMedia = castSession.loadMedia.getMockImplementation()!;
    let finishLoad!: () => void;
    castSession.loadMedia.mockImplementationOnce(async (request) => {
      await new Promise<void>((resolve) => { finishLoad = resolve; });
      await loadMedia(request);
      sdk.remote.activeTrackIds = [...request.activeTrackIds];
    });
    const loading = result.current.reload(1600);
    await waitFor(() => expect(finishLoad).toBeTypeOf('function'));
    rerender({ color: 'yellow' });
    act(() => result.current.setSubtitle(null));
    await act(async () => { finishLoad(); await loading; });
    expect(sdk.applied.at(-1)).toMatchObject({ foregroundColor: '#FFE14DFF' });
    expect(sdk.remote.activeTrackIds).toEqual([]);
    act(() => result.current.togglePlay());
    expect(sdk.controller.playOrPause).toHaveBeenCalled();
    locate.mockRejectedValueOnce(new Error('seek unavailable'));
    act(() => result.current.seek(1800));
    await waitFor(() => expect(result.current.error).toBe('seek unavailable'));
    act(() => result.current.stop());
    expect(result.current.active).toBe(false);
    unmount();
    expect(sdk.context.removeEventListener).toHaveBeenCalledWith('caststatechanged', expect.any(Function));
    expect(sdk.controller.removeEventListener).toHaveBeenCalledTimes(6);
    expect(sdk.listeners.size).toBe(0);
  });
});
