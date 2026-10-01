import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A browser with Media Source Extensions (the player uses hls.js), set before the player is loaded.
vi.hoisted(() => {
  (globalThis as unknown as { MediaSource: unknown }).MediaSource = { isTypeSupported: () => true };
});

// hls.js that cannot play the pieces (the server could not make them).
const hlsMade = vi.hoisted(() => ({ count: 0 }));
vi.mock('hls.js', () => {
  class Hls {
    static Events = { FRAG_LOADED: 'fragLoaded', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    private handlers: Record<string, (event: string, data: unknown) => void> = {};
    constructor() {
      hlsMade.count++;
    }
    on(event: string, fn: (event: string, data: unknown) => void) {
      this.handlers[event] = fn;
    }
    loadSource() {
      setTimeout(() => this.handlers.error?.('error', { fatal: true, type: 'otherError' }), 0);
    }
    attachMedia() {}
    startLoad() {}
    recoverMediaError() {}
    destroy() {}
  }
  return { default: Hls };
});

import Player from './Player';

const MOVIE = {"id": 3, "type": "movie", "title": "Test Film", "overview": null, "tagline": null, "originalTitle": null, "year": 2019, "runtime": 4, "releaseDate": null, "rating": null, "voteCount": null, "director": null, "posterPath": null, "backdropPath": null, "tmdbId": null, "imdbId": null, "libraryName": "Films", "match": {"status": "pending", "confidence": null, "parsedTitle": "Direct Film", "parsedYear": 2019}, "genres": [], "cast": [], "crew": [], "files": [{"id": 3, "fileName": "Direct Film (2019).webm", "size": 16314646, "container": "webm", "durationSec": 240.008, "bitrate": 543803, "videoCodec": "vp9", "videoProfile": "Profile 0", "videoBitDepth": 8, "videoRange": "SDR", "width": 640, "height": 360, "fps": 25, "audioCodec": "opus", "audioChannels": 1, "audioTracks": [{"index": 1, "codec": "opus", "language": null, "channels": 1, "channelLayout": "mono", "title": null, "isDefault": false, "languageName": null}], "embeddedSubtitles": [], "externalSubtitles": [], "probeError": null}], "progress": {"positionSec": 13, "durationSec": 240, "completed": false, "updatedAt": 1790789255532}, "favorite": false, "watchlist": false, "collections": [], "replacements": []};
const PLAYBACK = {"decision": {"engine": "remux", "streamUrl": "/api/media/3/remux?audio=1", "hlsUrl": "/api/media/3/hls/index.m3u8?audio=1", "compatible": true, "reasons": [], "seek": "restart", "audioIndex": 1, "note": null, "durationSec": 240.008, "mode": "direct"}, "analysis": {"mode": "direct", "browser": null, "video": {"codec": "vp9", "label": "VP9", "width": 640, "height": 360, "bitDepth": 8, "range": "SDR", "action": "direct"}, "audio": {"codec": "opus", "label": "Opus", "channels": 1, "action": "direct", "target": null}, "container": {"name": "webm", "action": "direct"}, "bitrate": 543803, "problems": [], "warnings": [], "transcodeRequired": false, "serverTranscoding": false, "serverLoad": "none", "device": null, "confidence": "reported", "components": {"video": {"status": "ok", "note": "Plays as-is"}, "audio": {"status": "ok", "note": "Plays as-is"}, "container": {"status": "ok", "note": "Supported"}}, "summary": ["No server-side conversion required."], "subtitles": {"text": [], "image": []}}, "file": {"id": 3, "fileName": "Direct Film (2019).webm", "size": 16314646, "container": "webm", "durationSec": 240.008, "bitrate": 543803, "videoCodec": "vp9", "videoProfile": "Profile 0", "videoBitDepth": 8, "videoRange": "SDR", "width": 640, "height": 360, "fps": 25, "audioCodec": "opus", "audioChannels": 1, "audioTracks": [{"index": 1, "codec": "opus", "language": null, "channels": 1, "channelLayout": "mono", "title": null, "isDefault": false, "languageName": null}], "embeddedSubtitles": [], "externalSubtitles": [], "probeError": null}, "subtitles": [], "onlineSubtitles": false};

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

describe('playing in pieces (HLS)', () => {
  it('carries on with the live stream when the pieces cannot be played, without an error', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Player kind="movie" id={3} search="?t=0" mini={false} onMinimize={() => undefined} onRestore={() => undefined} onClose={() => undefined} onPlayItem={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // First the pieces, through hls.js…
    await vi.waitFor(() => expect(hlsMade.count).toBe(1));
    // …then, once hls.js gives up, the live stream in the video element itself.
    await vi.waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('/api/media/3/remux?audio=1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
