import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Player from './Player';

// A browser that can cast, before any Chromecast was found.
const start = vi.fn(async (_at: number) => undefined);
const castState: { connecting: boolean; extra: Record<string, unknown> } = { connecting: false, extra: {} };
const reload = vi.fn(async (_at: number) => undefined);
vi.mock('../lib/cast', async (original) => ({
  ...(await original<typeof import('../lib/cast')>()),
  useCast: () => ({
    supported: true, available: false, connecting: castState.connecting, settled: false, active: false, fileId: null, device: null, time: 0, playing: false, volume: 1, muted: false, error: null,
    start, stop: vi.fn(), togglePlay: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), toggleMute: vi.fn(), setAudio: vi.fn(), setSubtitle: vi.fn(), reload, tvItem: null,
    ...castState.extra,
  }),
}));

// Real responses of a server for a small test film (direct play), as in Player.test.tsx.
const PLAYBACK = {"decision": {"engine": "direct", "streamUrl": "/api/media/3/stream", "compatible": true, "reasons": [], "seek": "range", "audioIndex": 1, "note": null, "durationSec": 240.008, "mode": "direct"}, "analysis": {"mode": "direct", "browser": null, "video": {"codec": "vp9", "label": "VP9", "width": 640, "height": 360, "bitDepth": 8, "range": "SDR", "action": "direct"}, "audio": {"codec": "opus", "label": "Opus", "channels": 1, "action": "direct", "target": null}, "container": {"name": "webm", "action": "direct"}, "bitrate": 543803, "problems": [], "warnings": [], "transcodeRequired": false, "serverTranscoding": false, "serverLoad": "none", "device": null, "confidence": "reported", "components": {"video": {"status": "ok", "note": "Plays as-is"}, "audio": {"status": "ok", "note": "Plays as-is"}, "container": {"status": "ok", "note": "Supported"}}, "summary": ["No server-side conversion required."], "subtitles": {"text": [], "image": []}}, "file": {"id": 3, "fileName": "Direct Film (2019).webm", "size": 16314646, "container": "webm", "durationSec": 240.008, "bitrate": 543803, "videoCodec": "vp9", "videoProfile": "Profile 0", "videoBitDepth": 8, "videoRange": "SDR", "width": 640, "height": 360, "fps": 25, "audioCodec": "opus", "audioChannels": 1, "audioTracks": [{"index": 1, "codec": "opus", "language": null, "channels": 1, "channelLayout": "mono", "title": null, "isDefault": false, "languageName": null}], "embeddedSubtitles": [], "externalSubtitles": [], "probeError": null}, "subtitles": [], "onlineSubtitles": false};
const MOVIE = {"id": 3, "type": "movie", "title": "Test Film", "overview": null, "tagline": null, "originalTitle": null, "year": 2019, "runtime": 4, "releaseDate": null, "rating": null, "voteCount": null, "director": null, "posterPath": null, "backdropPath": null, "tmdbId": null, "imdbId": null, "libraryName": "Films", "match": {"status": "pending", "confidence": null, "parsedTitle": "Direct Film", "parsedYear": 2019}, "genres": [], "cast": [], "crew": [], "files": [{"id": 3, "fileName": "Direct Film (2019).webm", "size": 16314646, "container": "webm", "durationSec": 240.008, "bitrate": 543803, "videoCodec": "vp9", "videoProfile": "Profile 0", "videoBitDepth": 8, "videoRange": "SDR", "width": 640, "height": 360, "fps": 25, "audioCodec": "opus", "audioChannels": 1, "audioTracks": [{"index": 1, "codec": "opus", "language": null, "channels": 1, "channelLayout": "mono", "title": null, "isDefault": false, "languageName": null}], "embeddedSubtitles": [], "externalSubtitles": [], "probeError": null}], "progress": {"positionSec": 13, "durationSec": 240, "completed": false, "updatedAt": 1790789255532}, "favorite": false, "watchlist": false, "collections": [], "replacements": []};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
    if (url === '/api/movies/3') return json(MOVIE);
    if (url === '/api/media/3/playback') return json(PLAYBACK);
    if (url === '/api/account/preferences') return json({ audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember' });
    return json({});
  }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  start.mockClear();
  castState.connecting = false;
  castState.extra = {};
  reload.mockClear();
});

function renderPlayer(search: string, onPlayItem: (kind: 'movie' | 'episode', id: number) => void = () => undefined) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Player kind="movie" id={3} search={search} mini={false} onMinimize={() => undefined} onRestore={() => undefined} onClose={() => undefined} onPlayItem={onPlayItem} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('cast button in the player', () => {
  it('is at the top right as soon as the browser can cast, also before a Chromecast was found', async () => {
    renderPlayer('?t=0');
    const button = await screen.findByRole('button', { name: 'Play on a TV (Chromecast)' });
    // In the top bar, next to the back button; not among the controls at the bottom.
    const top = screen.getByRole('button', { name: 'Back' }).parentElement!;
    expect(within(top).getByRole('button', { name: 'Play on a TV (Chromecast)' })).toBe(button);
    expect(screen.getAllByRole('button', { name: 'Play on a TV (Chromecast)' })).toHaveLength(1);
    // With the playback badge there, only the badge pushes to the right: two would split the space and
    // leave the badge in the middle of the bar.
    await vi.waitFor(() => expect(top.querySelector(':scope > .relative.ml-auto')).not.toBeNull());
    expect(top.querySelectorAll(':scope > .ml-auto')).toHaveLength(1);
    expect(top.lastElementChild).toBe(button);
    button.click();
    expect(start).toHaveBeenCalled();
  });

  it('starts the TV at the resume point when nothing played here yet', async () => {
    // Saved at 95 s: the player asks "resume?" and has not played anything.
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      const body = url === '/api/movies/3' ? { ...MOVIE, progress: { ...MOVIE.progress, positionSec: 95 } } : url === '/api/media/3/playback' ? PLAYBACK : url === '/api/account/preferences' ? { audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember' } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
    renderPlayer('');
    const button = await screen.findByRole('button', { name: 'Play on a TV (Chromecast)' });
    await screen.findByText('Test Film');
    button.click();
    expect(start).toHaveBeenCalledWith(95);
  });

  it('says it is connecting to the Chromecast', async () => {
    castState.connecting = true;
    renderPlayer('?t=0');
    expect((await screen.findByRole('status')).textContent).toBe('Connecting to the Chromecast…');
    expect(screen.getByRole('button', { name: 'Play on a TV (Chromecast)' }).getAttribute('aria-busy')).toBe('true');
  });

  it('follows the next episode the TV started itself, without loading the old title on the TV again', async () => {
    castState.extra = { active: true, fileId: 9, settled: true, tvItem: { kind: 'episode', id: 42, fileId: 9 } };
    const onPlayItem = vi.fn();
    renderPlayer('?t=0', onPlayItem);
    await screen.findAllByText('Test Film');
    await vi.waitFor(() => expect(onPlayItem).toHaveBeenCalledWith('episode', 42));
    expect(reload).not.toHaveBeenCalled();
  });

  it('still gives the TV another title chosen here while casting', async () => {
    castState.extra = { active: true, fileId: 9, settled: true, tvItem: null };
    renderPlayer('?t=0');
    await screen.findAllByText('Test Film');
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  });
});
