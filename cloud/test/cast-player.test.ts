import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { ProgressSaver, progressReport, progressTarget, SAVE_EVERY_MS, START_SLACK_SEC } from '../web/cast/progress.js';
import { showsSplash } from '../web/cast/screen.js';
import { barVisible, cssColor, cueCss, fileTimes, formatTime, SHOW_FOR_MS } from '../web/cast/overlay.js';
import { castStyle, castUrl, controlsFor, cycleStyle, DEFAULT_TV_STYLE, initialState, keyOf, loadRequestFor, press, segmentMarks, serverOf, skipAt, tabsFor, tvStyleFrom, upNextStart, words, type RemoteState } from '../web/cast/remote.js';

let dir: string;
let db: DB;
let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  db?.$client.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** What a Chromecast with Google TV says it is. */
const CHROMECAST = 'Mozilla/5.0 (Linux; Android 12; Build/STTE.230615.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.196 Safari/537.36 CrKey/1.56.500000 DeviceType/AndroidTV';

/** A request as a Chromecast makes it (the Host header decides what the service is). */
async function get(host: string, url: string, method = 'GET', userAgent = CHROMECAST): Promise<{ status: number; type: string; body: string; headers: http.IncomingHttpHeaders }> {
  const { port } = app.server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { host, 'user-agent': userAgent } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, type: String(res.headers['content-type'] ?? ''), body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function start() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cast-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example' });
  db = openDatabase(config.dbPath);
  app = await buildCloudApp(config, db);
  await app.listen({ port: 0, host: '127.0.0.1' });
}

describe('cast.vidalune.com', () => {
  it('serves Vidalune\'s cast player, and nothing else of the service', async () => {
    await start();
    const page = await get('cast.vidalune.example', '/');
    expect(page.status).toBe(200);
    expect(page.type).toContain('text/html');
    expect(page.body).toContain('https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js');
    // Vidalune's own player: Google's framework plays into Vidalune's video, not into its own player with its bar.
    expect(page.body).toContain('<video id="video">');
    expect(page.body).not.toContain('<cast-media-player>');
    for (const id of ['splash', 'bar', 'title', 'played', 'paused', 'waiting', 'cue-style', 'controls', 'menu', 'skip', 'upnext', 'keys']) expect(page.body, id).toContain(`id="${id}"`);
    expect(page.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    for (const [file, type] of [['receiver.js', 'text/javascript'], ['progress.js', 'text/javascript'], ['screen.js', 'text/javascript'], ['overlay.js', 'text/javascript'], ['remote.js', 'text/javascript'], ['cast.css', 'text/css'], ['logo.svg', 'image/svg+xml']]) {
      const res = await get('cast.vidalune.example', `/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.type, file).toContain(type);
    }
    // Dark everywhere: the light letters of the logo vanish on a white screen.
    const css = (await get('cast.vidalune.example', '/cast.css')).body;
    expect(css).toMatch(/html, body \{[^}]*background: #0f0d15/);
    expect(css).toMatch(/#splash \{[^}]*background: #0f0d15/);
    expect((await get('cast.vidalune.example', '/receiver.js')).body).toContain("setMediaElement(video)");
    expect((await get('cast.vidalune.example', '/robots.txt')).body).toContain('Disallow: /');
    // Only a Chromecast (or a TV with Chromecast built in) gets the player; a browser does not.
    const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
    for (const url of ['/', '/receiver.js', '/cast.css', '/logo.svg']) {
      const res = await get('cast.vidalune.example', url, 'GET', desktop);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('cast-media-player');
    }
    expect((await get('cast.vidalune.example', '/', 'GET', '')).status).toBe(404);
    expect((await get('cast.vidalune.example', '/', 'GET', 'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36 CrKey/1.54.250320')).status).toBe(200);
    // Not the account service, not other files, not a relay address.
    for (const url of ['/api/account', '/account', '/progress.d.ts', '/overlay.d.ts', '/remote.d.ts', '/../index.html', '/%2e%2e/index.html', '/admin']) expect((await get('cast.vidalune.example', url)).status, url).toBe(404);
    expect((await get('cast.vidalune.example', '/', 'POST')).status).toBe(404);
    expect(app.relay.slugOf({ headers: { host: 'cast.vidalune.example' } } as http.IncomingMessage)).toBeNull();
    // The website itself is unchanged.
    expect((await get('vidalune.example', '/')).body).not.toContain('cast-media-player');
  });
});

describe('the cast player\'s own screen', () => {
  it('covers Google\'s white screen until the TV plays', () => {
    for (const state of ['IDLE', 'LOADING', undefined, null]) expect(showsSplash(state), String(state)).toBe(true);
    for (const state of ['PLAYING', 'PAUSED', 'BUFFERING']) expect(showsSplash(state), state).toBe(false);
  });
});

describe('the cast player\'s own bar and subtitles', () => {
  it('shows the time in the file, also when the stream starts further in', () => {
    expect(formatTime(47 * 60 + 45)).toBe('47:45');
    expect(formatTime(3845)).toBe('1:04:05');
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
    // A repackaged stream that begins 600 s into a 2865 s episode, 104 s in.
    expect(fileTimes({ offset: 600, durationSec: 2865 }, 104, 2265)).toEqual({ position: 704, length: 2865 });
    // Another sender: only what the TV knows.
    expect(fileTimes(null, 104, 2865)).toEqual({ position: 104, length: 2865 });
    expect(fileTimes(null, 10, Number.NaN)).toEqual({ position: 10, length: 0 });
  });

  it('keeps the bar up while paused or waiting, and for a while after the last change', () => {
    expect(barVisible('PLAYING', 1000, 1000 + SHOW_FOR_MS - 1)).toBe(true);
    expect(barVisible('PLAYING', 1000, 1000 + SHOW_FOR_MS)).toBe(false);
    expect(barVisible('PAUSED', 0, 1e9)).toBe(true);
    expect(barVisible('BUFFERING', 0, 1e9)).toBe(true);
  });

  it('draws the subtitles in the sender\'s style, without a black box when it asks for none', () => {
    expect(cssColor('#FFE14DFF')).toBe('rgba(255, 225, 77, 1)');
    expect(cssColor('#00000099')).toBe('rgba(0, 0, 0, 0.6)');
    expect(cssColor('#123456')).toBe('rgba(18, 52, 86, 1)');
    expect(cssColor('red')).toBeNull();
    const yellow = cueCss({ fontScale: 1.2, foregroundColor: '#FFE14DFF', backgroundColor: '#00000001', edgeType: 'OUTLINE', edgeColor: '#000000FF' });
    expect(yellow).toContain('color: rgba(255, 225, 77, 1) !important');
    expect(yellow).toContain('background-color: rgba(0, 0, 0, 0.004) !important');
    expect(yellow).toContain('font-size: 5.52vh');
    expect(yellow).toContain('-2px -2px 0 rgba(0, 0, 0, 1)');
    expect(cueCss({ backgroundColor: '#000000EB' })).toContain('background-color: rgba(0, 0, 0, 0.922)');
    // The Android sender leaves a see-through background out altogether: still no black box.
    expect(cueCss({ foregroundColor: '#FFFFFFFF', edgeType: 'DROP_SHADOW' })).toContain('background-color: rgba(0, 0, 0, 0) !important');
    expect(cueCss(null)).toContain('background-color: rgba(0, 0, 0, 0) !important');
    expect(cueCss({ edgeType: 'NONE' })).toContain('text-shadow: none !important');
  });
});

describe('the cast player saving where the TV is', () => {
  const item = { url: 'https://abc.media.vidalune.com:32400/api/cast/progress?cast=t', offset: 0, durationSec: 6000 };

  it('takes the address only from a Vidalune sender, over https', () => {
    expect(progressTarget({ vidalune: { progressUrl: item.url, offset: 0, durationSec: 6000 } })).toEqual(item);
    expect(progressTarget({ vidalune: { progressUrl: 'http://192.168.1.5/api/cast/progress' } })).toBeNull();
    expect(progressTarget(undefined)).toBeNull();
    expect(progressTarget({ other: true })).toBeNull();
  });

  it('saves the position in the file, the length, and the end as watched to the end', () => {
    expect(progressReport(item, 600.04, 6000)).toEqual({ positionSec: 600, durationSec: 6000 });
    // A stream that starts later in the file counts from there; without a length, the stream's.
    expect(progressReport({ ...item, offset: 120, durationSec: 0 }, 30, 5880)).toEqual({ positionSec: 150, durationSec: 6000 });
    expect(progressReport(item, 5990, 6000, true)).toEqual({ positionSec: 6000, durationSec: 6000 });
    // Not started, or no length: nothing.
    expect(progressReport(item, 0, 6000)).toBeNull();
    expect(progressReport({ ...item, durationSec: 0 }, 10, Number.NaN)).toBeNull();
  });

  it('saves every 10 seconds while playing, at once on pause and stop, and never for a title that did not play', async () => {
    let clock = 0;
    const sent: Array<{ url: string; body: unknown }> = [];
    const saver = new ProgressSaver((url, body) => sent.push({ url, body }), () => clock);
    const flush = () => new Promise((r) => setTimeout(r, 0));
    saver.start(item);
    // Loaded at its resume point but stopped before it played: the resume point is kept.
    saver.save(0, 6000);
    saver.finish(0, 6000);
    await flush();
    expect(sent).toEqual([]);

    saver.start(item);
    clock = SAVE_EVERY_MS;
    saver.tick(100, 6000);
    clock += 1000;
    saver.tick(101, 6000);
    await flush();
    expect(sent.map((s) => s.body)).toEqual([{ positionSec: 100, durationSec: 6000 }]);
    clock += SAVE_EVERY_MS;
    saver.tick(111, 6000);
    saver.save(112, 6000);
    saver.finish(113, 6000);
    await flush();
    expect(sent.map((s) => s.body)).toEqual([100, 111, 112, 113].map((positionSec) => ({ positionSec, durationSec: 6000 })));
    expect(sent.every((s) => s.url === item.url)).toBe(true);
    // After it finished nothing more goes out for it.
    saver.tick(200, 6000);
    await flush();
    expect(sent).toHaveLength(4);
  });

  it('keeps going when a save fails', async () => {
    let calls = 0;
    const saver = new ProgressSaver(() => {
      calls++;
      throw new Error('offline');
    });
    saver.start(item);
    saver.tick(50, 6000);
    saver.save(60, 6000);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });

  it('keeps the resume point until the TV got there (it may begin at the start of the stream first)', async () => {
    const sent: Array<{ body: unknown }> = [];
    let clock = 0;
    const saver = new ProgressSaver((_url, body) => sent.push({ body }), () => clock);
    saver.start(item, 2700);
    // The TV plays from the beginning for a moment: nothing saved, also not when paused or stopped.
    saver.tick(3, 6000);
    clock += SAVE_EVERY_MS;
    saver.tick(14, 6000);
    saver.save(14, 6000);
    await new Promise((resolve) => setTimeout(resolve));
    expect(sent).toHaveLength(0);
    // Sent to the resume point (a keyframe just before it counts too): saved from there on.
    saver.tick(2700 - START_SLACK_SEC + 1, 6000);
    clock += SAVE_EVERY_MS;
    saver.tick(2712, 6000);
    saver.finish(2712, 6000);
    await new Promise((resolve) => setTimeout(resolve));
    expect(sent.at(-1)?.body).toEqual({ positionSec: 2712, durationSec: 6000 });
  });
});

describe('the cast player with a remote', () => {
  const ctx = { controls: controlsFor({ audioTracks: 2, hasNext: true }), tabs: tabsFor({ audioTracks: 2 }), items: { subtitles: 3, audio: 2, style: 3 }, selected: { subtitles: 2, audio: 1, style: 0 } };

  it('knows the keys of a remote and of a keyboard', () => {
    expect(keyOf({ key: 'ArrowLeft' })).toBe('left');
    expect(keyOf({ keyCode: 22 })).toBe('right');
    expect(keyOf({ keyCode: 23 })).toBe('ok');
    expect(keyOf({ key: 'Enter' })).toBe('ok');
    expect(keyOf({ key: 'MediaPlayPause' })).toBe('playpause');
    for (const event of [{ key: 'Escape' }, { key: 'GoBack' }, { keyCode: 4 }, { keyCode: 461 }]) expect(keyOf(event)).toBe('back');
    expect(keyOf({ key: 'a' })).toBeNull();
  });

  it('shows only the buttons and tabs that do something for this title', () => {
    expect(controlsFor({ audioTracks: 1, hasNext: false })).toEqual(['back', 'play', 'forward', 'subtitles']);
    expect(controlsFor({ audioTracks: 2, hasNext: true })).toEqual(['back', 'play', 'forward', 'subtitles', 'audio', 'next']);
    expect(tabsFor({ audioTracks: 1 })).toEqual(['subtitles', 'style']);
    expect(tabsFor({ audioTracks: 3 })).toEqual(['subtitles', 'audio', 'style']);
  });

  it('plays, jumps and brings up the buttons with nothing open; Back is left to the TV', () => {
    const s = initialState();
    expect(press(s, 'ok', ctx).action).toEqual({ type: 'toggle' });
    expect(press(s, 'left', ctx).action).toEqual({ type: 'seek', by: -10 });
    expect(press(s, 'right', ctx).action).toEqual({ type: 'seek', by: 10 });
    const up = press(s, 'up', ctx);
    expect(up.state.open).toBe('bar');
    expect(ctx.controls[up.state.focus]).toBe('play');
    const back = press(s, 'back', ctx);
    expect(back.handled).toBe(false);
    // OK skips the intro while that is offered.
    expect(press(s, 'ok', { ...ctx, skip: true }).action).toEqual({ type: 'skip' });
  });

  it('moves between the buttons and does what the chosen one says', () => {
    let s = press(initialState(), 'up', ctx).state;
    s = press(s, 'left', ctx).state;
    expect(press(s, 'ok', ctx).action).toEqual({ type: 'seek', by: -10 });
    s = press(s, 'left', ctx).state;
    expect(s.focus).toBe(0);
    for (let i = 0; i < 9; i += 1) s = press(s, 'right', ctx).state;
    expect(ctx.controls[s.focus]).toBe('next');
    expect(press(s, 'ok', ctx).action).toEqual({ type: 'next' });
    expect(press(s, 'down', ctx).state.open).toBe('none');
    expect(press(s, 'back', ctx).state.open).toBe('none');
  });

  it('opens the menu on the chosen subtitle, moves through it and between tabs, and picks', () => {
    let s: RemoteState = { ...initialState(), open: 'bar', focus: 3 };
    s = press(s, 'ok', ctx).state;
    expect(s).toMatchObject({ open: 'menu', tab: 'subtitles', item: 2 });
    s = press(s, 'down', ctx).state;
    expect(s.item).toBe(2);
    s = press(s, 'up', ctx).state;
    expect(press(s, 'ok', ctx).action).toEqual({ type: 'pick', tab: 'subtitles', index: 1 });
    s = press(s, 'right', ctx).state;
    expect(s).toMatchObject({ tab: 'audio', item: 1 });
    s = press(s, 'right', ctx).state;
    s = press(s, 'right', ctx).state;
    expect(s).toMatchObject({ tab: 'style', item: 0 });
    expect(press(s, 'back', ctx).state.open).toBe('bar');
  });

  it('starts or puts away the next episode from its card', () => {
    const card = { ...ctx, upNext: true };
    const s = initialState();
    expect(press(s, 'ok', card).action).toEqual({ type: 'next' });
    const right = press(s, 'right', card).state;
    expect(press(right, 'ok', card).action).toEqual({ type: 'dismissNext' });
    expect(press(s, 'back', card).action).toEqual({ type: 'dismissNext' });
    expect(press(s, 'up', card).state.open).toBe('bar');
  });

  it('offers skipping the recap, intro and credits as the website does', () => {
    const segments = { recap: { start: 0, end: 40 }, intro: { start: 60, end: 120, confidence: 'high' }, credits: { start: 2500, end: 2600 }, postCredits: { start: 2600, end: 2650 } };
    expect(skipAt(segments, 10)).toEqual({ kind: 'recap', to: 40 });
    expect(skipAt(segments, 60.5)).toBeNull();
    expect(skipAt(segments, 70)).toEqual({ kind: 'intro', to: 120 });
    expect(skipAt(segments, 119.5)).toBeNull();
    expect(skipAt(segments, 2510)).toEqual({ kind: 'credits', to: 2600 });
    expect(skipAt(null, 10)).toBeNull();
    expect(segmentMarks(segments, 2650)).toEqual([0.0151, 0.0226, 0.0453, 0.9434, 0.9811]);
  });

  it('brings the next episode card up at the end credits, or near the end', () => {
    expect(upNextStart({ credits: { start: 2500, end: 2598 } }, 2600)).toBe(2500);
    expect(upNextStart({ credits: { start: 2500, end: 2598 }, postCredits: { start: 2598, end: 2600 } }, 2600)).toBe(2588);
    expect(upNextStart(null, 2600)).toBe(2588);
    expect(upNextStart(null, 0)).toBeNull();
  });

  it('chooses the subtitle style on the TV, without a black box when the background is off', () => {
    let style = cycleStyle(DEFAULT_TV_STYLE, 0);
    expect(style.size).toBe('large');
    style = cycleStyle(cycleStyle(style, 2), 2);
    expect(style.background).toBe('solid');
    style = cycleStyle(style, 2);
    expect(castStyle(style).backgroundColor).toBe('#00000001');
    expect(tvStyleFrom(castStyle({ size: 'xlarge', color: 'yellow', background: 'translucent' }))).toEqual({ size: 'xlarge', color: 'yellow', background: 'translucent' });
    expect(tvStyleFrom(null)).toEqual(DEFAULT_TV_STYLE);
  });

  it('loads the next episode itself, from the session the server gave the TV', () => {
    expect(serverOf('https://abc.media.vidalune.example:32400/api/cast/progress?cast=tok')).toEqual({ base: 'https://abc.media.vidalune.example:32400', token: 'tok' });
    expect(serverOf('not a url')).toBeNull();
    expect(serverOf('https://abc.example/api/cast/progress')).toBeNull();
    expect(castUrl('https://s.example', '/api/media/7/hls/index.m3u8?audio=1', 't', 0)).toBe('https://s.example/api/media/7/hls/index.m3u8?audio=1&cast=t');
    const session = {
      token: 'new',
      contentType: 'application/vnd.apple.mpegurl',
      decision: { streamUrl: '/api/media/8/hls/index.m3u8', durationSec: 2600 },
      subtitles: [{ url: '/api/subtitles/1', label: 'English', language: 'en' }, { url: '/api/subtitles/2', label: 'Nederlands', language: 'nl' }],
      item: { kind: 'episode', id: 12, fileId: 8, title: 'The Show', subtitle: 'S01E02 — Two', posterPath: '/p.jpg', resumeAt: 120 },
    };
    const request = loadRequestFor(session, { base: 'https://s.example', at: 120, style: castStyle(DEFAULT_TV_STYLE), subtitleLanguage: 'nl', audioIndex: 2 });
    expect(request.currentTime).toBe(120);
    expect(request.activeTrackIds).toEqual([2]);
    expect(request.media.contentId).toBe('https://s.example/api/media/8/hls/index.m3u8?cast=new');
    expect(request.media.metadata).toMatchObject({ title: 'The Show', subtitle: 'S01E02 — Two', images: [{ url: 'https://s.example/api/images/w342/p.jpg?cast=new' }] });
    expect(request.media.customData.vidalune).toEqual({ progressUrl: 'https://s.example/api/cast/progress?cast=new', offset: 0, durationSec: 2600, fileId: 8, item: { kind: 'episode', id: 12 }, audioIndex: 2 });
    expect(request.media.tracks[1]).toMatchObject({ trackId: 2, trackContentId: 'https://s.example/api/subtitles/2?cast=new', language: 'nl' });
    // The TV saves progress for it with the new token, as for a title a sender loaded.
    expect(progressTarget(request.media.customData)).toEqual({ url: 'https://s.example/api/cast/progress?cast=new', offset: 0, durationSec: 2600 });
    expect(loadRequestFor(session, { base: 'https://s.example' }).activeTrackIds).toEqual([]);
  });

  it('speaks Dutch on a Dutch TV and English elsewhere', () => {
    expect(words('nl-NL').skipIntro).toBe('Intro overslaan');
    expect(words('nl-NL').nextIn.replace('{n}', '8')).toBe('Volgende aflevering over 8 s');
    expect(words('en-US').skipIntro).toBe('Skip intro');
    expect(words(undefined).playNow).toBe('Play now');
  });
});
