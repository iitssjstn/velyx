import { describe, expect, it } from 'vitest';
import { castAddress, castLoadRequest, castTextTrackStyle, castTrackIds, loadCastWithCurrentSubtitle, openCastDialog, sessionUsable, tvFilePosition, type CastSession } from './cast';

const url = (path: string) => `http://nas:3000${path.startsWith('/') ? path : `/${path}`}`;
const session = (seek: 'range' | 'restart'): CastSession => ({
  token: 'tok.en',
  expiresAt: 10_000_000,
  serverUrl: null,
  contentType: 'video/mp4',
  decision: { engine: seek === 'range' ? 'direct' : 'remux', streamUrl: seek === 'range' ? '/api/media/5/stream' : '/api/media/5/remux?audio=1', seek, durationSec: 3000 },
  subtitles: [
    { key: 'ext-2', label: 'English', language: 'en', url: '/api/subtitles/2.vtt' },
    { key: 'emb-3', label: 'Nederlands', language: 'nl', url: '/api/media/5/subtitles/3.vtt' },
  ],
});

describe('casting from the app', () => {
  it('gives the Chromecast addresses with the token', () => {
    expect(castAddress('http://nas:3000/api/media/5/stream', 'a.b')).toBe('http://nas:3000/api/media/5/stream?cast=a.b');
    expect(castAddress('https://x.vidalune.com/api/media/5/remux?audio=1', 't', { start: '12.000' })).toBe('https://x.vidalune.com/api/media/5/remux?audio=1&start=12.000&cast=t');
  });

  it('continues a file as it is where the phone was, with artwork and the chosen subtitle', () => {
    const { request, offset } = castLoadRequest({ session: session('range'), url, title: 'Dune', subtitle: '2021', artwork: '/api/images/w780/back.jpg', at: 600, keyframe: null, subtitleKey: 'emb-3' });
    expect(offset).toBe(0);
    expect(request).toMatchObject({ autoplay: true, startTime: 600, activeTrackIds: [2] });
    expect(request.mediaInfo).toMatchObject({ contentUrl: 'http://nas:3000/api/media/5/stream?cast=tok.en', contentType: 'video/mp4', streamDuration: 3000 });
    expect(request.mediaInfo.metadata).toEqual({ type: 'generic', title: 'Dune', subtitle: '2021', images: [{ url: 'http://nas:3000/api/images/w780/back.jpg?cast=tok.en' }] });
    expect(request.mediaInfo.mediaTracks[1]).toEqual({ id: 2, type: 'text', subtype: 'subtitles', contentId: 'http://nas:3000/api/media/5/subtitles/3.vtt?cast=tok.en', contentType: 'text/vtt', name: 'Nederlands', language: 'nl' });
    expect(request.mediaInfo.streamType).toBe('BUFFERED');
    expect(request.mediaInfo.textTrackStyle).toMatchObject({ fontScale: 1, foregroundColor: '#FFFFFFFF', backgroundColor: '#00000000', edgeType: 'dropShadow' });
  });

  it('maps saved app subtitle preferences to the Cast receiver style', () => {
    const style = { size: 'large' as const, color: 'yellow' as const, background: 'none' as const, edge: 'outline' as const, position: 0 };
    expect(castTextTrackStyle(style)).toMatchObject({ fontFamily: 'sans-serif', fontGenericFamily: 'sansSerif', fontScale: 1.2, foregroundColor: '#FFE14DFF', backgroundColor: '#00000000', edgeType: 'outline' });
    const { request } = castLoadRequest({ session: session('range'), url, title: 'Dune', subtitle: null, artwork: null, at: 0, keyframe: null, subtitleKey: null, subtitleStyle: style });
    expect(request.mediaInfo.textTrackStyle).toMatchObject({ fontScale: 1.2, foregroundColor: '#FFE14DFF', edgeType: 'outline' });
  });

  it('loads remuxed casts as finite HLS with the full file duration', () => {
    const source = session('range');
    source.contentType = 'application/vnd.apple.mpegurl';
    source.decision = { ...source.decision, engine: 'remux', streamUrl: '/api/media/5/hls/index.m3u8?audio=1&copy=1' };
    const { request, offset } = castLoadRequest({ session: source, url, title: 'Dune', subtitle: null, artwork: null, at: 600, keyframe: null, subtitleKey: null });
    expect(offset).toBe(0);
    expect(request.startTime).toBe(600);
    expect(request.mediaInfo).toMatchObject({
      contentUrl: 'http://nas:3000/api/media/5/hls/index.m3u8?audio=1&copy=1&cast=tok.en',
      contentType: 'application/vnd.apple.mpegurl',
      streamType: 'BUFFERED',
      streamDuration: 3000,
    });
  });

  it('starts a repackaged stream at the keyframe, with subtitles on the same clock', () => {
    const { request, offset } = castLoadRequest({ session: session('restart'), url, title: 'Dune', subtitle: null, artwork: null, at: 600, keyframe: { offset: 598, seek: 598.5 }, subtitleKey: null });
    expect(offset).toBe(598);
    expect(request.startTime).toBe(2);
    expect(request.activeTrackIds).toEqual([]);
    expect(request.mediaInfo.contentUrl).toBe('http://nas:3000/api/media/5/remux?audio=1&start=598.500&cast=tok.en');
    expect(request.mediaInfo.streamDuration).toBe(2402);
    expect(request.mediaInfo.mediaTracks[0].contentId).toBe('http://nas:3000/api/subtitles/2.vtt?offset=598.000&cast=tok.en');
    expect(request.mediaInfo.metadata).toEqual({ type: 'generic', title: 'Dune' });
    // From the start: no keyframe needed.
    expect(castLoadRequest({ session: session('restart'), url, title: 'Dune', subtitle: null, artwork: null, at: 0, keyframe: null, subtitleKey: null }).request.mediaInfo.contentUrl).toBe('http://nas:3000/api/media/5/remux?audio=1&cast=tok.en');
  });

  it.each(['emb-3', null])('preserves a subtitle change to %s during a cast seek reload', async (next) => {
    const source = session('restart');
    let selected: string | null = 'ext-2';
    const { request } = castLoadRequest({ session: source, url, title: 'Dune', subtitle: null, artwork: null, at: 600, keyframe: { offset: 598, seek: 598.5 }, subtitleKey: selected });
    let loaded!: () => void;
    const selections: number[][] = [];
    const loading = loadCastWithCurrentSubtitle({ request, session: source, subtitleKey: () => selected, load: () => new Promise<void>((resolve) => { loaded = resolve; }), select: async (ids) => { selections.push(ids); } });
    expect(request.activeTrackIds).toEqual([1]);
    selected = next;
    loaded();
    await loading;
    expect(selections).toEqual([next === null ? [] : [2]]);
    expect(request.mediaInfo.mediaTracks[1]!.contentId).toContain('offset=598.000');
  });

  it('switches subtitles on the TV and asks for a new session in time, or for another audio track', () => {
    expect(castTrackIds(session('range'), 'ext-2')).toEqual([1]);
    expect(castTrackIds(session('range'), 'online-9')).toEqual([]);
    expect(castTrackIds(null, 'ext-2')).toEqual([]);
    expect(sessionUsable(session('range'), 1, 1, 1000)).toBe(true);
    expect(sessionUsable(session('range'), 2, 1, 1000)).toBe(false);
    expect(sessionUsable(session('range'), 1, 1, 9_990_000)).toBe(false);
    expect(sessionUsable(null, 1, 1)).toBe(false);
  });
});

describe('opening the Chromecast list', () => {
  it('says so when the list does not open, instead of doing nothing', async () => {
    const said: unknown[] = [];
    await openCastDialog(async () => true, (m) => said.push(m));
    expect(said).toEqual([]);
    await openCastDialog(async () => false, (m) => said.push(m));
    expect(said).toEqual(['player.castNoDialog']);
    await openCastDialog(async () => {
      throw new Error('Cast framework not ready');
    }, (m) => said.push(m));
    expect((said[1] as Error).message).toBe('Cast framework not ready');
  });
});

describe('tvFilePosition', () => {
  it('turns the TV\'s stream position into file time, ignoring what is not usable yet', () => {
    expect(tvFilePosition(0, 754.2)).toBe(754.2);
    // A repackaged stream started at 1200 s in the file.
    expect(tvFilePosition(1200, 30)).toBe(1230);
    expect(tvFilePosition(0, 0)).toBeNull();
    expect(tvFilePosition(0, Number.NaN)).toBeNull();
  });
});

