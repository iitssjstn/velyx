import { ProgressSaver, progressTarget, START_SLACK_SEC } from './progress.js';
import { needsTracks, showsSplash, startOptions } from './screen.js';
import { barVisible, cueCss, fileTimes, formatTime } from './overlay.js';
import {
  CONTROLS_FOR_MS,
  DEFAULT_TV_STYLE,
  NEXT_COUNTDOWN,
  STYLE_ROWS,
  castStyle,
  castUrl,
  controlsFor,
  cycleStyle,
  initialState,
  keyOf,
  loadRequestFor,
  press,
  segmentMarks,
  serverOf,
  skipAt,
  tabsFor,
  tvStyleFrom,
  upNextStart,
  words,
} from './remote.js';

/**
 * Vidalune's cast player (cast.vidalune.com, app id 920BF057). Google's receiver framework plays
 * into Vidalune's own video element; everything over it is Vidalune's own: the bar with the title
 * and time, the buttons and menu for a remote (remote.js), skipping the intro, the next episode, and
 * the subtitles in the chosen style. A TV without a remote is operated from the app or website as
 * before. It saves where the TV is itself (see progress.js).
 */
const context = cast.framework.CastReceiverContext.getInstance();
const player = context.getPlayerManager();
const { MessageType, PlayerState, HlsSegmentFormat, HlsVideoSegmentFormat } = cast.framework.messages;
const { EventType } = cast.framework.events;

const $ = (id) => document.getElementById(id);
const video = $('video');
player.setMediaElement(video);
const say = words(navigator.language);

const saver = new ProgressSaver((url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }),
);
const now = () => [player.getCurrentTimeSec(), player.getDurationSec()];

// Where the sender asked the TV to start (the resume point), and where in the file the stream begins.
let wantedStart = 0;
// The subtitle the sender asked for: the framework can drop it while loading (HLS), so it is put back.
let wantedTracks = [];
let target = null;
// The server and cast token of what plays, and what the server told the TV about it (/api/cast/tv).
let server = null;
let info = null;
let audioIndex = null;
// When the bar was last brought up (a title starting, playing again, a jump), and the last key.
let shownAt = 0;
let keyAt = 0;
const showBar = () => (shownAt = Date.now());
let remote = initialState();

// "Next episode": put away for this title, and how far the countdown is.
let nextDismissed = false;
let countdown = NEXT_COUNTDOWN;
let loadingNext = false;

/* ---- Subtitle style: the sender's, unless the viewer chose one on the TV (kept on this TV). ---- */
const STYLE_KEY = 'vidalune.tvStyle';
const storedStyle = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STYLE_KEY) ?? 'null');
    return value && typeof value === 'object' ? { ...DEFAULT_TV_STYLE, ...value } : null;
  } catch {
    return null;
  }
};
const storeStyle = (style) => {
  try {
    if (style) localStorage.setItem(STYLE_KEY, JSON.stringify(style));
    else localStorage.removeItem(STYLE_KEY);
  } catch {
    // Without storage the choice holds until the TV closes the player.
  }
};
let senderStyle = null;
let tvStyle = storedStyle();
const currentStyle = () => tvStyle ?? tvStyleFrom(senderStyle);

/** The subtitles in this style on the video (also when it changes while casting). */
const applyStyle = (style) => {
  if (style) $('cue-style').textContent = cueCss(style);
};
// Until a sender says otherwise: white letters with a shadow, no black box.
applyStyle(tvStyle ? castStyle(tvStyle) : {});

// A poster that does not load is left out (no broken image in the bar).
$('poster').addEventListener('error', () => $('poster').removeAttribute('src'));

/** The title, the line above it and the poster, from what was loaded. */
const showTitle = (metadata) => {
  const title = typeof metadata?.title === 'string' ? metadata.title : '';
  const subtitle = typeof metadata?.subtitle === 'string' ? metadata.subtitle : '';
  const image = Array.isArray(metadata?.images) && typeof metadata.images[0]?.url === 'string' ? metadata.images[0].url : '';
  $('title').textContent = title;
  $('subtitle').textContent = subtitle;
  $('splash-title').textContent = title;
  if (image) $('poster').src = image;
  else $('poster').removeAttribute('src');
};

/** Asks the server what the TV can offer for this title: audio tracks, intro and credits, the next episode. */
const learn = async () => {
  info = null;
  if (!server) return;
  const asked = server;
  try {
    const res = await fetch(castUrl(asked.base, '/api/cast/tv', asked.token));
    if (res.ok && server === asked) info = await res.json();
  } catch {
    // Without it the TV still plays, jumps and shows subtitles.
  }
  render();
};

/** Everything a new title needs, from the TV's own load or a sender's. */
const prepare = (request) => {
  // What played before is saved first.
  saver.finish(...now());
  const media = request.media;
  // Repackaged titles come as HLS with fMP4 pieces (init.mp4 and .m4s).
  if (media && /mpegurl/i.test(media.contentType ?? '')) {
    media.hlsSegmentFormat = HlsSegmentFormat.FMP4;
    media.hlsVideoSegmentFormat = HlsVideoSegmentFormat.FMP4;
  }
  wantedStart = Number(request.currentTime) > 0 ? Number(request.currentTime) : 0;
  wantedTracks = Array.isArray(request.activeTrackIds) ? request.activeTrackIds.slice() : [];
  target = progressTarget(media?.customData);
  const data = media?.customData?.vidalune;
  server = target ? serverOf(target.url) : null;
  audioIndex = Number.isInteger(data?.audioIndex) ? data.audioIndex : null;
  saver.start(target, wantedStart);
  showTitle(media?.metadata);
  if (media?.textTrackStyle) senderStyle = media.textTrackStyle;
  // A style chosen on this TV wins over the sender's.
  if (media && tvStyle) media.textTrackStyle = castStyle(tvStyle);
  applyStyle(media?.textTrackStyle);
  nextDismissed = false;
  countdown = NEXT_COUNTDOWN;
  remote = { ...remote, open: 'none' };
  showBar();
  void learn();
};

// A load the TV starts itself (next episode, other audio) is prepared before it goes out.
let ownLoad = null;
player.setMessageInterceptor(MessageType.LOAD, (request) => {
  if (ownLoad && request.media?.contentId === ownLoad) ownLoad = null;
  else prepare(request);
  return request;
});

// A new subtitle style from a sender while casting: the sender chose it, so it replaces the TV's.
if (MessageType.EDIT_TRACKS_INFO)
  player.setMessageInterceptor(MessageType.EDIT_TRACKS_INFO, (request) => {
    if (request.textTrackStyle) {
      senderStyle = request.textTrackStyle;
      tvStyle = null;
      storeStyle(null);
      applyStyle(request.textTrackStyle);
    }
    return request;
  });

// Should the player begin at the start of the stream anyway, it is sent there once the title has loaded.
if (EventType.PLAYER_LOAD_COMPLETE)
  player.addEventListener(EventType.PLAYER_LOAD_COMPLETE, () => {
    if (wantedStart > START_SLACK_SEC && player.getCurrentTimeSec() + START_SLACK_SEC < wantedStart) player.seek(wantedStart);
    restoreTracks();
    loadingNext = false;
    showBar();
  });
for (const type of [EventType.PLAY, EventType.SEEKED]) if (type) player.addEventListener(type, showBar);

/* ---- Where the TV is in the file (a stream can begin `offset` seconds in). ---- */
const offset = () => (target && target.offset > 0 ? target.offset : 0);
const times = () => fileTimes(target, ...now());

// ←/→ add up while pressed quickly; the TV jumps once they stop.
let pendingSeek = null;
let seekTimer = 0;
const seekBy = (by) => {
  const { position, length } = times();
  const from = pendingSeek ?? position;
  pendingSeek = Math.max(0, length > 0 ? Math.min(length - 1, from + by) : from + by);
  clearTimeout(seekTimer);
  seekTimer = setTimeout(() => {
    const to = pendingSeek;
    pendingSeek = null;
    if (to !== null) player.seek(Math.max(0, to - offset()));
  }, 450);
  showBar();
};
const seekTo = (fileTime) => {
  pendingSeek = null;
  clearTimeout(seekTimer);
  player.seek(Math.max(0, fileTime - offset()));
};

/* ---- Subtitles and audio as the menu lists them. ---- */
// Puts the asked subtitle back when the title loaded without one (once per load).
const restoreTracks = () => {
  const wanted = wantedTracks;
  wantedTracks = [];
  try {
    const manager = player.getTextTracksManager();
    if (needsTracks(wanted, manager.getActiveIds(), manager.getTracks()?.map((t) => t.trackId))) manager.setActiveByIds(wanted);
  } catch {
    // No text tracks on this title.
  }
};
const textTracks = () => {
  try {
    return player.getTextTracksManager().getTracks() ?? [];
  } catch {
    return [];
  }
};
const activeText = () => {
  try {
    const ids = player.getTextTracksManager().getActiveIds() ?? [];
    return textTracks().findIndex((t) => ids.includes(t.trackId));
  } catch {
    return -1;
  }
};
const audioTracks = () => (Array.isArray(info?.audio) ? info.audio : []);
const activeAudio = () => Math.max(0, audioTracks().findIndex((t) => t.index === audioIndex));

/** Loads a session the server gave the TV (the next episode, or this title with other audio). */
const loadSession = (session, { at, audio = null }) => {
  if (!server) return;
  const subtitle = textTracks()[activeText()];
  const built = loadRequestFor(session, { base: server.base, at, style: castStyle(currentStyle()), subtitleLanguage: subtitle?.language ?? null, audioIndex: audio });
  const request = new cast.framework.messages.LoadRequestData();
  request.media = Object.assign(new cast.framework.messages.MediaInformation(), built.media);
  request.currentTime = built.currentTime;
  request.autoplay = built.autoplay;
  request.activeTrackIds = built.activeTrackIds;
  prepare(request);
  ownLoad = request.media.contentId;
  return player.load(request);
};

const askSession = async (body) => {
  if (!server) return null;
  const res = await fetch(castUrl(server.base, '/api/cast/tv/session', server.token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.ok ? res.json() : null;
};

const playNext = async () => {
  if (loadingNext || !info?.next) return;
  loadingNext = true;
  try {
    // The next episode in the language playing now (its default track when it does not have it).
    const language = audioTracks().find((t) => t.index === audioIndex)?.language;
    const session = await askSession({ next: true, ...(language ? { audioLanguage: language } : {}) });
    if (session) await loadSession(session, { at: session.item?.resumeAt ?? 0, audio: Number.isInteger(session.decision?.audioIndex) ? session.decision.audioIndex : null });
    else loadingNext = false;
  } catch {
    loadingNext = false;
  }
};

const pickAudio = async (index) => {
  const track = audioTracks()[index];
  if (!track || track.index === audioIndex) return;
  const at = times().position;
  try {
    const session = await askSession({ audioIndex: track.index });
    if (session) await loadSession(session, { at, audio: track.index });
  } catch {
    // The title keeps playing with the audio it had.
  }
};

const pickSubtitle = (index) => {
  try {
    const manager = player.getTextTracksManager();
    const track = textTracks()[index - 1];
    if (track) manager.setActiveByIds([track.trackId]);
    else manager.setActiveByIds([]);
  } catch {
    // Not every title has subtitles loaded yet.
  }
};

const pickStyle = (row) => {
  tvStyle = cycleStyle(currentStyle(), row);
  storeStyle(tvStyle);
  const style = castStyle(tvStyle);
  applyStyle(style);
  try {
    player.getTextTracksManager().setTextTrackStyle(Object.assign(new cast.framework.messages.TextTrackStyle(), style));
  } catch {
    // The video's own style (applyStyle) already shows it.
  }
};

/* ---- The remote. ---- */
const controls = () => controlsFor({ audioTracks: audioTracks().length, hasNext: Boolean(info?.next) });
const tabs = () => tabsFor({ audioTracks: audioTracks().length });
const skipNow = () => skipAt(info?.segments ?? null, times().position);
const upNextNow = () => {
  if (!info?.next || nextDismissed) return false;
  const { position, length } = times();
  const start = upNextStart(info.segments ?? null, length);
  return start !== null && position >= start;
};

document.addEventListener('keydown', (event) => {
  const key = keyOf(event);
  // Play/pause and the jump keys of the remote reach Google's framework already.
  if (!key || key === 'playpause' || key === 'forward' || key === 'rewind') return;
  const result = press(remote, key, {
    controls: controls(),
    tabs: tabs(),
    items: { subtitles: textTracks().length + 1, audio: audioTracks().length, style: STYLE_ROWS.length },
    selected: { subtitles: activeText() + 1, audio: activeAudio(), style: 0 },
    skip: Boolean(skipNow()),
    upNext: upNextNow() && remote.open === 'none',
  });
  if (!result.handled) return;
  event.preventDefault();
  remote = result.state;
  keyAt = Date.now();
  const action = result.action;
  if (action?.type === 'toggle') {
    if (player.getPlayerState() === PlayerState.PAUSED) player.play();
    else player.pause();
  } else if (action?.type === 'seek') seekBy(action.by);
  else if (action?.type === 'skip') {
    const skip = skipNow();
    if (skip) seekTo(skip.to);
  } else if (action?.type === 'next') void playNext();
  else if (action?.type === 'dismissNext') nextDismissed = true;
  else if (action?.type === 'pick') {
    if (action.tab === 'subtitles') pickSubtitle(action.index);
    else if (action.tab === 'audio') void pickAudio(action.index);
    else pickStyle(action.index);
  }
  render();
});

/* ---- Drawing. ---- */
const ICONS = {
  back: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16" font-size="6" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>',
  forward: '<svg viewBox="0 0 24 24"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16" font-size="6" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  subtitles: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="15.5" font-size="7" text-anchor="middle" font-family="sans-serif" font-weight="700">CC</text></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8a5 5 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5v14l9-7zM17 5h2v14h-2z"/></svg>',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const setHtml = (el, html) => {
  if (el.innerHTML !== html) el.innerHTML = html;
};

const drawControls = (paused) => {
  const html = controls()
    .map((name, i) => {
      const focus = remote.open === 'bar' && i === remote.focus ? ' focus' : '';
      if (name === 'back' || name === 'forward') return `<div class="pill round${focus}">${ICONS[name]}</div>`;
      if (name === 'play') return `<div class="pill round${focus}">${paused ? ICONS.play : ICONS.pause}</div>`;
      return `<div class="pill${focus}">${ICONS[name]}${esc(say[name])}</div>`;
    })
    .join('');
  setHtml($('controls'), html);
};

const drawMenu = () => {
  setHtml($('tabs'), tabs().map((tab) => `<span class="${tab === remote.tab ? 'on' : ''}">${esc(say[tab])}</span>`).join(''));
  $('menu-title').textContent = say[remote.tab];
  $('menu-hint').textContent = remote.tab === 'style' ? say.remembered : '';
  let rows;
  if (remote.tab === 'subtitles') {
    const active = activeText() + 1;
    rows = [{ label: say.off }, ...textTracks().map((t) => ({ label: t.name || t.language || '' }))].map((row, i) => ({ ...row, on: i === active }));
  } else if (remote.tab === 'audio') {
    const active = activeAudio();
    rows = audioTracks().map((t, i) => ({ label: t.label, on: i === active }));
  } else {
    const style = currentStyle();
    rows = STYLE_ROWS.map((row) => ({ label: say[row.key], value: say[style[row.key]] }));
  }
  setHtml(
    $('items'),
    rows
      .map((row, i) => `<div class="${i === remote.item ? 'focus' : ''}"><span>${esc(row.label)}</span>${row.value ? `<span>${esc(row.value)}</span>` : row.on ? '<b>✓</b>' : ''}</div>`)
      .join(''),
  );
};

const drawUpNext = (show) => {
  $('upnext').classList.toggle('on', show);
  if (!show || !info?.next) return;
  const next = info.next;
  $('upnext-label').textContent = say.nextIn.replace('{n}', String(Math.max(0, Math.ceil(countdown))));
  $('upnext-code').textContent = next.title ?? '';
  $('upnext-title').textContent = next.subtitle ?? '';
  $('upnext-length').textContent = next.durationSec > 0 ? formatTime(next.durationSec) : '';
  const still = next.stillPath ?? next.posterPath;
  $('upnext-still').style.backgroundImage = still && server ? `url("${castUrl(server.base, `/api/images/w300/${String(still).replace(/^\//, '')}`, server.token)}")` : '';
  $('upnext-count').style.width = `${Math.min(100, ((NEXT_COUNTDOWN - countdown) / NEXT_COUNTDOWN) * 100)}%`;
  $('upnext-play').textContent = say.playNow;
  $('upnext-credits').textContent = say.watchCredits;
  $('upnext-play').classList.toggle('focus', remote.nextFocus === 0);
  $('upnext-credits').classList.toggle('focus', remote.nextFocus === 1);
};

/** Draws the screen before the film, the bar and buttons, the menu, skip and the next episode. */
function render() {
  const state = player.getPlayerState();
  const paused = state === PlayerState.PAUSED;
  // The buttons close by themselves a while after the last key (not while paused or in the menu).
  if (remote.open === 'bar' && !paused && Date.now() - keyAt > CONTROLS_FOR_MS) remote = { ...remote, open: 'none' };
  $('splash').classList.toggle('gone', !showsSplash(state));
  $('waiting').classList.toggle('on', state === PlayerState.BUFFERING || loadingNext);
  $('paused').classList.toggle('on', paused && remote.open === 'none');
  const active = remote.open !== 'none';
  const up = active || pendingSeek !== null || barVisible(state, shownAt, Date.now());
  $('bar').classList.toggle('on', up);
  $('bar').classList.toggle('active', active);
  $('keys').classList.toggle('on', active);
  setHtml($('keys'), `<span><b>OK</b>${esc(say.keysOk)}</span><span><b>◀ ▶</b>${esc(say.keysSeek)}</span><span><b>▲ ▼</b>${esc(say.keysBar)}</span><span><b>↩</b>${esc(say.keysBack)}</span>`);
  $('menu').classList.toggle('on', remote.open === 'menu');
  if (remote.open === 'menu') drawMenu();

  const { position, length } = times();
  const shown = pendingSeek ?? position;
  if (up) {
    $('position').textContent = formatTime(shown);
    $('length').textContent = length > 0 ? formatTime(length) : '';
    $('played').style.width = length > 0 ? `${Math.min(100, (shown / length) * 100)}%` : '0';
    setHtml($('marks'), segmentMarks(info?.segments ?? null, length).map((f) => `<i style="left:${(f * 100).toFixed(2)}%"></i>`).join(''));
    drawControls(paused);
  }

  // Back before the card's start (a jump back): the card may come again.
  const start = info?.next ? upNextStart(info.segments ?? null, length) : null;
  if (start !== null && position < start - 1) {
    nextDismissed = false;
    countdown = NEXT_COUNTDOWN;
  }
  const card = upNextNow() && !active;
  drawUpNext(card);
  const skip = card || active ? null : skipNow();
  $('skip').classList.toggle('on', Boolean(skip));
  document.body.classList.toggle('bar-on', up);
  if (skip) setHtml($('skip'), `${ICONS.next}${esc(say[skip.kind === 'recap' ? 'skipRecap' : skip.kind === 'credits' ? 'skipCredits' : 'skipIntro'])}`);
}
if (EventType.MEDIA_STATUS) player.addEventListener(EventType.MEDIA_STATUS, render);
setInterval(render, 250);

setInterval(() => {
  const state = player.getPlayerState();
  if (state === PlayerState.PLAYING) {
    // Still before the resume point (the framework ignored the start time): sent there again.
    const to = saver.startSeek(player.getCurrentTimeSec());
    if (to !== null) player.seek(to);
    saver.tick(...now());
  }
  // The card counts down while the film plays; at zero the next episode starts.
  if (state === PlayerState.PLAYING && upNextNow() && remote.open === 'none') {
    countdown -= 1;
    if (countdown <= 0) void playNext();
  }
}, 1000);
player.addEventListener(EventType.PAUSE, () => saver.save(...now()));
player.addEventListener(EventType.MEDIA_FINISHED, (event) => {
  // Replaced by another title: that load already saved this one (and the new one must not be finished).
  if (event.endedReason === cast.framework.events.EndedReason.INTERRUPTED) return;
  const time = typeof event.currentMediaTime === 'number' ? event.currentMediaTime : player.getCurrentTimeSec();
  const ended = event.endedReason === cast.framework.events.EndedReason.END_OF_STREAM;
  saver.finish(time, player.getDurationSec(), ended);
  // To the end without putting the card away: the next episode, as on the website.
  if (ended && info?.next && !nextDismissed && !loadingNext) void playNext();
});

context.start(startOptions(cast.framework.ui.UiConfig));
