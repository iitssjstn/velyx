import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MoviePage } from './MovieDetail';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'user', username: 'anna' } }) }));
afterEach(() => vi.unstubAllGlobals());

const uhd = {
  id: 11, fileName: 'Dune (2021) 2160p.mkv', size: 60 * 1024 ** 3, container: 'mkv', durationSec: 9360, bitrate: 24_000_000,
  videoCodec: 'hevc', videoProfile: 'Main 10', videoBitDepth: 10, videoRange: 'HDR10', width: 3840, height: 2160, fps: 23.976, audioCodec: 'eac3', audioChannels: 6,
  audioTracks: [
    { index: 1, codec: 'eac3', language: 'eng', languageName: 'English', channels: 6, channelLayout: '5.1', title: null, isDefault: true },
    { index: 2, codec: 'aac', language: 'nld', languageName: 'Dutch', channels: 2, channelLayout: 'stereo', title: null, isDefault: false },
  ],
  embeddedSubtitles: [{ index: 3, codec: 'subrip', language: 'eng', languageName: 'English', title: null, isDefault: false, isForced: false, textBased: true }],
  externalSubtitles: [{ id: 9, language: 'nl', label: 'Dutch', format: 'srt', forced: false }],
  probeError: null,
};
const hd = { ...uhd, id: 12, fileName: 'Dune (2021) 1080p.mkv', videoCodec: 'h264', videoProfile: 'High', videoBitDepth: 8, videoRange: 'SDR', width: 1920, height: 1080, bitrate: 8_000_000, embeddedSubtitles: [], externalSubtitles: [] };
const movie = {
  id: 5, type: 'movie', title: 'Dune', originalTitle: null, year: 2021, overview: 'Paul Atreides…', tagline: null, runtime: 155, releaseDate: null, rating: null, voteCount: null, director: null,
  posterPath: null, backdropPath: null, tmdbId: null, imdbId: null, libraryName: 'Movies', match: { status: 'matched', confidence: 1, parsedTitle: 'Dune', parsedYear: 2021 },
  genres: [], cast: [], crew: [], files: [uhd, hd], progress: { positionSec: 1934, durationSec: 9360, completed: false }, favorite: false, watchlist: false, collections: [], replacements: [],
};
const component = (status: string, note: string) => ({ status, note });
const analysis = (fileId: number) =>
  fileId === 11
    ? { mode: 'remux', browser: 'Chrome', device: 'Chrome on Windows', confidence: 'reported', video: { codec: 'hevc', label: 'HEVC', width: 3840, height: 2160, bitDepth: 10, range: 'HDR10', action: 'copy' }, audio: { codec: 'eac3', label: 'Dolby Digital+', channels: 6, action: 'convert', target: 'aac' }, container: { name: 'mkv', action: 'remux' }, problems: [], warnings: [], transcodeRequired: false, serverTranscoding: false, serverLoad: 'low', components: { video: component('ok', 'Played as is'), audio: component('warn', 'Converted to AAC'), container: component('ok', 'Repackaged') }, summary: ['The audio is converted to AAC; the video is not touched.'] }
    : { mode: 'direct', browser: 'Chrome', device: 'Chrome on Windows', confidence: 'reported', video: { codec: 'h264', label: 'H.264', width: 1920, height: 1080, bitDepth: 8, range: 'SDR', action: 'direct' }, audio: { codec: 'eac3', label: 'Dolby Digital+', channels: 6, action: 'direct', target: null }, container: { name: 'mkv', action: 'direct' }, problems: [], warnings: [], transcodeRequired: false, serverTranscoding: false, serverLoad: 'none', components: { video: component('ok', 'Played as is'), audio: component('ok', 'Played as is'), container: component('ok', 'Played as is') }, summary: ['Plays directly.'] };

function setup({ failCheck = false } = {}) {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url });
    if (url === '/api/movies/5') return new Response(JSON.stringify(movie), { status: 200 });
    const m = /^\/api\/media\/(\d+)\/playback$/.exec(url);
    if (m && failCheck) return new Response(JSON.stringify({ error: 'Media file is no longer available.' }), { status: 404 });
    if (m) return new Response(JSON.stringify({ decision: {}, analysis: analysis(Number(m[1])), file: {}, subtitles: [] }), { status: 200 });
    if (url.includes('/similar')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/movies/5']}>
        <Routes>
          <Route path="/movies/:id" element={<MoviePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('movie page', () => {
  it('shows year, length and quality, and offers Resume and Start over', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Dune' })).toBeTruthy();
    expect(screen.getByText('2021')).toBeTruthy();
    expect(screen.getByText('2h 35m')).toBeTruthy();
    expect(screen.getByText('4K HDR', { selector: 'li' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Resume from 32:14/ }).getAttribute('href')).toContain('t=1934');
    expect(screen.getByRole('link', { name: /From start/ }).getAttribute('href')).toContain('t=0');
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy();
  });

  it('lists audio, subtitles and technical details of the file', async () => {
    setup();
    const audio = await screen.findByRole('region', { name: 'Audio' });
    expect(within(audio).getByText('English 5.1')).toBeTruthy();
    expect(within(audio).getByText('Dutch Stereo')).toBeTruthy();
    const subs = screen.getByRole('region', { name: 'Subtitles' });
    expect(within(subs).getByText('Dutch')).toBeTruthy();
    expect(within(subs).getByText('English')).toBeTruthy();
    const tech = within(screen.getByRole('region', { name: 'Technical' })).getByRole('list', { name: 'Video format' });
    expect(within(tech).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['HEVC', '10-bit', 'HDR10', '24.0 Mbps']);
  });

  it('says how the chosen version plays on this device, and checks each version once', async () => {
    const calls = setup();
    const playback = await screen.findByRole('region', { name: 'Playback on this device' });
    expect(await within(playback).findByText('Remux · Audio → AAC')).toBeTruthy();
    expect(within(playback).getByText(/Checked for Chrome on Windows/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Version' }), '1080p');
    expect(await within(screen.getByRole('region', { name: 'Playback on this device' })).findByText('Direct Play')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Technical' })).getByText('H.264')).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Version' }), '4K HDR');
    await within(screen.getByRole('region', { name: 'Playback on this device' })).findByText('Remux · Audio → AAC');
    expect(calls.filter((c) => c.url === '/api/media/11/playback')).toHaveLength(1);
    expect(calls.filter((c) => c.url === '/api/media/12/playback')).toHaveLength(1);
    // Checking is only a question: nothing is played or recorded.
    expect(calls.some((c) => c.url.includes('/remux') || c.url.startsWith('/api/progress'))).toBe(false);
  });

  it('explains when the check is not possible', async () => {
    setup({ failCheck: true });
    expect(await screen.findByText('Could not check playback for this device.')).toBeTruthy();
    // The rest of the page still works.
    expect(screen.getByRole('region', { name: 'Audio' })).toBeTruthy();
  });
});
