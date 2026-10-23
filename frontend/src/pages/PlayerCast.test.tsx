import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Player from './Player';
import { getPrefs, setPrefs } from '../lib/prefs';

// A browser that can cast, before any Chromecast was found.
const start = vi.fn(async (_at: number) => undefined);
const castState: { connecting: boolean; extra: Record<string, unknown> } = { connecting: false, extra: {} };
const reload = vi.fn(async (_at: number) => undefined);
let castMedia: { subtitleKey?: string | null } | null = null;
vi.mock('../lib/cast', async (original) => ({
  ...(await original<typeof import('../lib/cast')>()),
  useCast: (media: { subtitleKey?: string | null } | null) => (castMedia = media, {
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

type Hooks = Partial<Pick<Parameters<typeof Player>[0], 'mini' | 'onMinimize' | 'onRestore' | 'onClose' | 'onCasting'>>;
function renderPlayer(search: string, onPlayItem: (kind: 'movie' | 'episode', id: number) => void = () => undefined, hooks: Hooks = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Player kind="movie" id={3} search={search} mini={false} onMinimize={() => undefined} onRestore={() => undefined} onClose={() => undefined} onPlayItem={onPlayItem} {...hooks} />
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

  it('gives a computer the same big remote as a phone while casting, not the dimmed controls', async () => {
    castState.extra = { active: true, fileId: 3, settled: true, device: 'Living room', tvItem: null };
    renderPlayer('?t=0');
    const remote = await screen.findByRole('region', { name: 'Cast remote' });
    // No md:hidden: on a computer it used to be hidden, with a dark layer over the normal controls instead.
    expect(remote.className).not.toContain('md:hidden');
    expect(within(remote).getByText('Living room')).toBeTruthy();
    expect(within(remote).getByRole('button', { name: 'Close the remote (the TV keeps playing)' })).toBeTruthy();
    // The length comes from the server: the video here never loads while casting.
    expect(within(remote).getByText('4:00')).toBeTruthy();
    // The normal control bar is not shown at all while casting.
    expect(screen.getByRole('button', { name: 'Full screen', hidden: true }).closest('.hidden')).toBeTruthy();
  });

  it('closes the remote by sliding it down to the cast bar, with the TV playing on', async () => {
    castState.extra = { active: true, fileId: 3, settled: true, device: 'Living room', tvItem: null };
    const onMinimize = vi.fn();
    const onClose = vi.fn();
    const onCasting = vi.fn();
    renderPlayer('?t=0', undefined, { onMinimize, onClose, onCasting });
    const remote = await screen.findByRole('region', { name: 'Cast remote' });
    expect(remote.className).toContain('animate-sheet-up');
    expect(onCasting).toHaveBeenLastCalledWith(true);
    vi.useFakeTimers();
    try {
      fireEvent.click(within(remote).getByRole('button', { name: 'Close the remote (the TV keeps playing)' }));
      expect(remote.className).toContain('translate-y-full');
      expect(onMinimize).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(400));
    } finally {
      vi.useRealTimers();
    }
    // Minimized, not closed: the player stays (as the cast bar) and casting goes on.
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is a cast bar along the bottom when minimized while casting', async () => {
    const stop = vi.fn();
    castState.extra = { active: true, fileId: 3, settled: true, device: 'Living room', tvItem: null, time: 60, playing: true, stop };
    const onRestore = vi.fn();
    const onClose = vi.fn();
    renderPlayer('?t=0', undefined, { mini: true, onRestore, onClose });
    const bar = await screen.findByRole('region', { name: 'Cast remote' });
    expect(bar.className).toContain('inset-x-0');
    expect(bar.className).toContain('animate-bar-up');
    expect(document.documentElement.classList.contains('has-cast-bar')).toBe(true);
    await within(bar).findByText('Test Film');
    expect(within(bar).getByText('Living room')).toBeTruthy();
    // Not the small video player: its picture is hidden, and the TV's position shows.
    expect(bar.querySelector('video:not(.hidden)')).toBeNull();
    const controls = within(within(bar).getByRole('button', { name: 'Stop casting' }).parentElement!);
    expect(controls.getByText('1:00')).toBeTruthy();
    expect(controls.getByText('4:00')).toBeTruthy();
    // The poster with the full-screen sign (and the title) open the big remote again.
    fireEvent.click(controls.getAllByRole('button', { name: 'Open full player' })[0]!);
    expect(onRestore).toHaveBeenCalledTimes(1);
    fireEvent.click(controls.getByRole('button', { name: 'Stop casting' }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('follows the next episode the TV started itself, without loading the old title on the TV again', async () => {
    castState.extra = { active: true, fileId: 9, settled: true, tvItem: { kind: 'episode', id: 42, fileId: 9 } };
    const onPlayItem = vi.fn();
    renderPlayer('?t=0', onPlayItem);
    await screen.findAllByText('Test Film');
    await vi.waitFor(() => expect(onPlayItem).toHaveBeenCalledWith('episode', 42));
    expect(reload).not.toHaveBeenCalled();
  });

  it('gives the TV the subtitle chosen before when a title opens while casting (the video here never loads)', async () => {
    castState.extra = { active: true, fileId: 9, settled: true, tvItem: null };
    setPrefs({ subtitleLanguage: 'en', subtitleForced: false, subtitleLabel: '' });
    const sub = { key: 'emb-2', kind: 'embedded', label: 'English', language: 'eng', forced: false, isDefault: false, url: '/api/media/3/subtitles/2.vtt' };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      const body = url === '/api/movies/3' ? MOVIE : url === '/api/media/3/playback' ? { ...PLAYBACK, subtitles: [sub] } : url === '/api/account/preferences' ? { audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember' } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
    renderPlayer('?t=0');
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(castMedia?.subtitleKey).toBe('emb-2');
    setPrefs({ subtitleLanguage: '', subtitleForced: false, subtitleLabel: '' });
  });

  it('keeps the remembered subtitle and audio when the TV first reports what it was given, and takes a change made on the TV', async () => {
    castState.extra = { active: true, fileId: 3, settled: true, tvItem: null, tvSubtitleKey: null, tvAudioIndex: 1 };
    setPrefs({ subtitleLanguage: 'en', subtitleForced: false, subtitleLabel: '', audioLanguage: 'eng' });
    const eng = { key: 'emb-1', kind: 'embedded', label: 'English', language: 'eng', forced: false, isDefault: false, url: '/api/media/3/subtitles/1.vtt' };
    const sub = { key: 'emb-2', kind: 'embedded', label: 'Français', language: 'fre', forced: false, isDefault: false, url: '/api/media/3/subtitles/2.vtt' };
    const ita = { ...PLAYBACK.file.audioTracks[0], index: 1, language: 'ita' };
    const movie = { ...MOVIE, files: [{ ...MOVIE.files[0], audioTracks: [ita] }] };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      const body = url === '/api/movies/3' ? movie : url === '/api/media/3/playback' ? { ...PLAYBACK, file: { ...PLAYBACK.file, audioTracks: [ita] }, subtitles: [eng, sub] } : url === '/api/account/preferences' ? { audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember' } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const tree = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Player kind="movie" id={3} search="?t=0" mini={false} onMinimize={() => undefined} onRestore={() => undefined} onClose={() => undefined} onPlayItem={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(tree());
    await screen.findAllByText('Test Film');
    await new Promise((r) => setTimeout(r, 50));
    // English is picked here; the TV first reports no subtitle and its default (Italian) track: not a
    // choice made there.
    await vi.waitFor(() => expect(castMedia?.subtitleKey).toBe('emb-1'));
    expect(getPrefs().subtitleLanguage).toBe('en');
    expect(getPrefs().audioLanguage).toBe('eng');
    // Then the viewer picks French on the TV: that is remembered.
    castState.extra = { ...castState.extra, tvSubtitleKey: 'emb-2' };
    view.rerender(tree());
    await vi.waitFor(() => expect(getPrefs().subtitleLanguage).toBe('fr'));
    // The TV then reports no subtitle (Google's framework lost the track while loading): not a choice,
    // so the subtitle stays remembered.
    castState.extra = { ...castState.extra, tvSubtitleKey: null };
    view.rerender(tree());
    await new Promise((r) => setTimeout(r, 50));
    expect(getPrefs().subtitleLanguage).toBe('fr');
    expect(castMedia?.subtitleKey).not.toBeNull();
    setPrefs({ subtitleLanguage: '', subtitleForced: false, subtitleLabel: '', audioLanguage: '' });
  });

  it('still gives the TV another title chosen here while casting', async () => {
    castState.extra = { active: true, fileId: 9, settled: true, tvItem: null };
    renderPlayer('?t=0');
    await screen.findAllByText('Test Film');
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  });
});
