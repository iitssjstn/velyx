import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Player from './Player';

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
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Player kind="movie" id={3} search="?t=0" mini={false} onMinimize={() => undefined} onRestore={() => undefined} onClose={() => undefined} onPlayItem={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const spinnerShown = () => screen.queryAllByLabelText('Loading').length > 0;

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
});
