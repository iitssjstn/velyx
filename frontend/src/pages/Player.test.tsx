import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Player from './Player';

const frameRequestDescriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'requestVideoFrameCallback');
const frameCancelDescriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'cancelVideoFrameCallback');
let latestFrame: ((now: number, metadata: unknown) => void) | null = null;

// Real responses of a server for a small test film (direct play).
const MOVIE = {"id": 3, "type": "movie", "title": "Test Film", "overview": null, "tagline": null, "originalTitle": null, "year": 2019, "runtime": 4, "releaseDate": null, "rating": null, "voteCount": null, "director": null, "posterPath": null, "backdropPath": null, "tmdbId": null, "imdbId": null, "libraryName": "Films", "match": {"status": "pending", "confidence": null, "parsedTitle": "Direct Film", "parsedYear": 2019}, "genres": [], "cast": [], "crew": [], "files": [{"id": 3, "fileName": "Direct Film (2019).webm", "size": 16314646, "container": "webm", "durationSec": 240.008, "bitrate": 543803, "videoCodec": "vp9", "videoProfile": "Profile 0", "videoBitDepth": 8, "videoRange": "SDR", "width": 640, "height": 360, "fps": 25, "audioCodec": "opus", "audioChannels": 1, "audioTracks": [{"index": 1, "codec": "opus", "language": null, "channels": 1, "channelLayout": "mono", "title": null, "isDefault": false, "languageName": null}], "embeddedSubtitles": [], "externalSubtitles": [], "probeError": null}], "progress": {"positionSec": 13, "durationSec": 240, "completed": false, "updatedAt": 1790789255532}, "favorite": false, "watchlist": false, "collections": [], "replacements": []};
const PLAYBACK = {"decision": {"engine": "direct", "streamUrl": "/api/media/3/stream", "compatible": true, "reasons": [], "seek": "range", "audioIndex": 1, "note": null, "durationSec": 240.008, "mode": "direct"}, "analysis": {"mode": "direct", "browser": null, "video": {"codec": "vp9", "label": "VP9", "width": 640, "height": 360, "bitDepth": 8, "range": "SDR", "action": "direct"}, "audio": {"codec": "opus", "label": "Opus", "channels": 1, "action": "direct", "target": null}, "container": {"name": "webm", "action": "direct"}, "bitrate": 543803, "problems": [], "warnings": [], "transcodeRequired": false, "serverTranscoding": false, "serverLoad": "none", "device": null, "confidence": "reported", "components": {"video": {"status": "ok", "note": "Plays as-is"}, "audio": {"status": "ok", "note": "Plays as-is"}, "container": {"status": "ok", "note": "Supported"}}, "summary": ["No server-side conversion required."], "subtitles": {"text": [], "image": []}}, "file": {"id": 3, "fileName": "Direct Film (2019).webm", "size": 16314646, "container": "webm", "durationSec": 240.008, "bitrate": 543803, "videoCodec": "vp9", "videoProfile": "Profile 0", "videoBitDepth": 8, "videoRange": "SDR", "width": 640, "height": 360, "fps": 25, "audioCodec": "opus", "audioChannels": 1, "audioTracks": [{"index": 1, "codec": "opus", "language": null, "channels": 1, "channelLayout": "mono", "title": null, "isDefault": false, "languageName": null}], "embeddedSubtitles": [], "externalSubtitles": [], "probeError": null}, "subtitles": [], "onlineSubtitles": false};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
      if (url === '/api/movies/3') return json(MOVIE);
      if (url === '/api/media/3/playback') return json(PLAYBACK);
      if (url === '/api/account/preferences') return json({ audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember' });
      return json({});
    }),
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (frameRequestDescriptor) Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', frameRequestDescriptor);
  else Reflect.deleteProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback');
  if (frameCancelDescriptor) Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', frameCancelDescriptor);
  else Reflect.deleteProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback');
  latestFrame = null;
});

/** What the browser reports about the video element, changed by the test. */
function fakeVideo(video: HTMLVideoElement) {
  const state = { readyState: 1, paused: false, currentTime: 0 };
  for (const key of Object.keys(state) as Array<keyof typeof state>)
    Object.defineProperty(video, key, { configurable: true, get: () => state[key], set: (v: never) => (state[key] = v) });
  Object.defineProperty(video, 'duration', { configurable: true, get: () => 240 });
  return state;
}

function renderPlayer() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Player kind="movie" id={3} search="?t=0" mini={false} onMinimize={() => undefined} onRestore={() => undefined} onClose={() => undefined} onPlayItem={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const spinnerShown = () => screen.queryAllByLabelText('Loading').length > 0;

describe('subtitles after seeking', () => {
  it('drops the old stream subtitle and loads shifted cues after a remux seek', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      let body: unknown = {};
      if (url === '/api/movies/3') body = MOVIE;
      if (url === '/api/media/3/playback') body = { ...PLAYBACK, decision: { ...PLAYBACK.decision, engine: 'remux', seek: 'restart', streamUrl: '/api/media/3/remux?audio=1' }, subtitles: [{ key: 'ext-1', kind: 'external', label: 'English', language: 'eng', forced: false, isDefault: true, url: '/api/subtitles/1.vtt' }] };
      if (url === '/api/account/preferences') body = { audioLanguage: '', subtitleLanguage: 'eng', subtitleFallback: '', subtitleMode: 'always' };
      if (url.startsWith('/api/media/3/keyframe')) body = { start: 118, seek: 118 };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    renderPlayer();
    const oldVideo = await vi.waitFor(() => {
      const video = document.querySelector('video');
      if (!video?.querySelector('track')) throw new Error('no video track');
      return video;
    });
    const oldState = fakeVideo(oldVideo);
    oldState.currentTime = 10;
    const oldTrack = { mode: 'disabled', cues: [{ startTime: 9, endTime: 12, text: 'Subtitle before remux seek' }] };
    Object.defineProperty(oldVideo, 'textTracks', { configurable: true, value: { length: 1, 0: oldTrack } });
    Object.defineProperty(oldVideo.querySelector('track'), 'track', { configurable: true, value: oldTrack });
    fireEvent.loadedMetadata(oldVideo);
    expect(await screen.findByText('Subtitle before remux seek')).toBeTruthy();
    fireEvent.keyDown(window, { key: '5' });
    const newVideo = await vi.waitFor(() => {
      const video = document.querySelector('video');
      if (!video || video === oldVideo) throw new Error('stream has not restarted');
      return video;
    });
    expect(screen.queryByText('Subtitle before remux seek')).toBeNull();
    expect(newVideo.getAttribute('src')).toBe('/api/media/3/remux?audio=1&start=118.000');
    expect(newVideo.querySelector('track')?.getAttribute('src')).toBe('/api/subtitles/1.vtt?offset=118.000');
    const state = fakeVideo(newVideo);
    state.currentTime = 2;
    const newTrack = { mode: 'disabled', cues: [{ startTime: 1, endTime: 4, text: 'Subtitle after remux seek' }] };
    Object.defineProperty(newVideo, 'textTracks', { configurable: true, value: { length: 1, 0: newTrack } });
    Object.defineProperty(newVideo.querySelector('track'), 'track', { configurable: true, value: newTrack });
    fireEvent.loadedMetadata(newVideo);
    fireEvent.load(newVideo.querySelector('track')!);
    expect(await screen.findByText('Subtitle after remux seek')).toBeTruthy();
  });

  it('reattaches the chosen subtitle when its text track becomes available after video metadata', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      let body: unknown = {};
      if (url === '/api/movies/3') body = MOVIE;
      if (url === '/api/media/3/playback') body = { ...PLAYBACK, subtitles: [{ key: 'ext-1', kind: 'external', label: 'English', language: 'eng', forced: false, isDefault: true, url: '/api/subtitles/1.vtt' }] };
      if (url === '/api/account/preferences') body = { audioLanguage: '', subtitleLanguage: 'eng', subtitleFallback: '', subtitleMode: 'always' };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    renderPlayer();
    const video = await vi.waitFor(() => {
      const element = document.querySelector('video');
      if (!element?.querySelector('track')) throw new Error('subtitle track not mounted');
      return element;
    });
    const state = fakeVideo(video);
    const tracks = { length: 0 };
    Object.defineProperty(video, 'textTracks', { configurable: true, value: tracks });
    fireEvent.loadedMetadata(video);
    state.currentTime = 30;
    fireEvent.seeked(video);
    const track = { mode: 'disabled', cues: [{ startTime: 29, endTime: 32, text: 'Subtitle at the new position' }] };
    const native = { mode: 'showing', cues: [{ startTime: 29, endTime: 32, text: 'Wrong native caption' }] };
    Object.assign(tracks, { length: 2, 0: native, 1: track });
    Object.defineProperty(video.querySelector('track'), 'track', { configurable: true, value: track });
    fireEvent.load(video.querySelector('track')!);
    expect(await screen.findByText('Subtitle at the new position')).toBeTruthy();
    expect(track.mode).toBe('hidden');
    expect(native.mode).toBe('disabled');
    expect(screen.queryByText('Wrong native caption')).toBeNull();
    act(() => { track.cues.push({ startTime: 59, endTime: 62, text: 'Subtitle further ahead' }); });
    fireEvent.seeking(video);
    expect(screen.queryByText('Subtitle at the new position')).toBeNull();
    state.currentTime = 60;
    fireEvent.seeked(video);
    expect(await screen.findByText('Subtitle further ahead')).toBeTruthy();
    state.currentTime = 30;
    fireEvent.seeking(video);
    fireEvent.seeked(video);
    expect(await screen.findByText('Subtitle at the new position')).toBeTruthy();
  });
});

describe('the loading spinner of the player', () => {
  it('goes away once the picture moves, also when the browser never reports "playing" again', async () => {
    renderPlayer();
    const video = await vi.waitFor(() => {
      const v = document.querySelector('video');
      if (!v) throw new Error('no video yet');
      return v;
    });
    const state = fakeVideo(video);
    fireEvent.loadedMetadata(video);
    // A stall: the browser reports "waiting" and has nothing to play for a moment.
    state.readyState = 2;
    fireEvent.waiting(video);
    await vi.waitFor(() => expect(spinnerShown()).toBe(true));
    // It plays on (data there, time moving) without a "playing", "canplay" or "timeupdate" event.
    state.readyState = 4;
    await act(async () => {
      state.currentTime = 1;
      await new Promise((r) => setTimeout(r, 600));
      state.currentTime = 2;
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(spinnerShown()).toBe(false);
  });

  it('stays while the video really waits for data', async () => {
    renderPlayer();
    const video = await vi.waitFor(() => {
      const v = document.querySelector('video');
      if (!v) throw new Error('no video yet');
      return v;
    });
    const state = fakeVideo(video);
    fireEvent.loadedMetadata(video);
    state.readyState = 2;
    fireEvent.waiting(video);
    await act(() => new Promise((r) => setTimeout(r, 1200)));
    expect(spinnerShown()).toBe(true);
  });

  it('ignores a "waiting" while there is enough to play on', async () => {
    renderPlayer();
    const video = await vi.waitFor(() => {
      const v = document.querySelector('video');
      if (!v) throw new Error('no video yet');
      return v;
    });
    const state = fakeVideo(video);
    fireEvent.loadedMetadata(video);
    state.readyState = 4;
    fireEvent.playing(video);
    await vi.waitFor(() => expect(spinnerShown()).toBe(false));
    fireEvent.waiting(video);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(spinnerShown()).toBe(false);
  });

  it('never covers a video that plays, even while the browser keeps reporting "waiting"', async () => {
    renderPlayer();
    const video = await vi.waitFor(() => {
      const v = document.querySelector('video');
      if (!v) throw new Error('no video yet');
      return v;
    });
    const state = fakeVideo(video);
    fireEvent.loadedMetadata(video);
    // A live stream with a thin buffer: "waiting" again and again, little data ahead, yet it plays on.
    state.readyState = 2;
    await act(async () => {
      for (let i = 1; i <= 8; i++) {
        state.currentTime = i * 0.25;
        fireEvent.waiting(video);
        await new Promise((r) => setTimeout(r, 250));
      }
    });
    expect(spinnerShown()).toBe(false);
    // It really stops: the spinner comes back after a moment.
    fireEvent.waiting(video);
    await act(() => new Promise((r) => setTimeout(r, 2000)));
    expect(spinnerShown()).toBe(true);
  });

  it('clears loading from rendered frames even when currentTime stalls, after closing and reopening', async () => {
    let id = 0;
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
      configurable: true,
      value: (callback: (now: number, metadata: unknown) => void) => {
        latestFrame = callback;
        return ++id;
      },
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', { configurable: true, value: () => undefined });

    for (let cycle = 0; cycle < 2; cycle++) {
      const mounted = renderPlayer();
      const video = await vi.waitFor(() => {
        const v = document.querySelector('video');
        if (!v) throw new Error('no video yet');
        return v;
      });
      const state = fakeVideo(video);
      fireEvent.loadedMetadata(video);
      state.readyState = 2;
      fireEvent.waiting(video);
      await vi.waitFor(() => expect(spinnerShown()).toBe(true));
      expect(latestFrame).toBeTypeOf('function');
      await act(async () => latestFrame?.(performance.now(), { mediaTime: 1 }));
      expect(state.currentTime).toBe(0);
      expect(spinnerShown()).toBe(false);
      mounted.unmount();
    }
  });
});
