import { ProgressSaver, progressTarget, START_SLACK_SEC } from './progress.js';
import { showsSplash } from './screen.js';
import { barVisible, cueCss, fileTimes, formatTime } from './overlay.js';

/**
 * Vidalune's cast player (cast.vidalune.com, app id 920BF057). Google's receiver framework plays
 * into Vidalune's own video element; the bar with the title and time, the pause sign, the screen
 * before the film and the subtitle style are Vidalune's own. It saves where the TV is itself (see
 * progress.js).
 */
const context = cast.framework.CastReceiverContext.getInstance();
const player = context.getPlayerManager();
const { MessageType, PlayerState, HlsSegmentFormat, HlsVideoSegmentFormat } = cast.framework.messages;
const { EventType } = cast.framework.events;

const $ = (id) => document.getElementById(id);
const video = $('video');
player.setMediaElement(video);

const saver = new ProgressSaver((url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }),
);
const now = () => [player.getCurrentTimeSec(), player.getDurationSec()];

// Where the sender asked the TV to start (the resume point), and where in the file the stream begins.
let wantedStart = 0;
let target = null;
// When the bar was last brought up (a title starting, playing again, a jump).
let shownAt = 0;
const showBar = () => (shownAt = Date.now());

/** The subtitles in the style the sender asked for (also when it changes it while casting). */
const applyStyle = (style) => {
  if (!style) return;
  $('cue-style').textContent = cueCss(style);
};
// Until a sender says otherwise: white letters with a shadow, no black box.
applyStyle({});

/** The title, the line above it and the poster, from what the sender sent. */
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

player.setMessageInterceptor(MessageType.LOAD, (request) => {
  // What played before is saved first.
  saver.finish(...now());
  const media = request.media;
  // Repackaged titles come as HLS with fMP4 pieces (init.mp4 and .m4s).
  if (media && /mpegurl/i.test(media.contentType ?? '')) {
    media.hlsSegmentFormat = HlsSegmentFormat.FMP4;
    media.hlsVideoSegmentFormat = HlsVideoSegmentFormat.FMP4;
  }
  wantedStart = Number(request.currentTime) > 0 ? Number(request.currentTime) : 0;
  target = progressTarget(media?.customData);
  saver.start(target, wantedStart);
  showTitle(media?.metadata);
  applyStyle(media?.textTrackStyle);
  showBar();
  return request;
});

// A new subtitle style while casting.
if (MessageType.EDIT_TRACKS_INFO)
  player.setMessageInterceptor(MessageType.EDIT_TRACKS_INFO, (request) => {
    applyStyle(request.textTrackStyle);
    return request;
  });

// Should the player begin at the start of the stream anyway, it is sent there once the title has loaded.
if (EventType.PLAYER_LOAD_COMPLETE)
  player.addEventListener(EventType.PLAYER_LOAD_COMPLETE, () => {
    if (wantedStart > START_SLACK_SEC && player.getCurrentTimeSec() + START_SLACK_SEC < wantedStart) player.seek(wantedStart);
    showBar();
  });
for (const type of [EventType.PLAY, EventType.SEEKED]) if (type) player.addEventListener(type, showBar);

/** Draws the screen before the film, the bar, the pause sign and the waiting circle. */
const render = () => {
  const state = player.getPlayerState();
  $('splash').classList.toggle('gone', !showsSplash(state));
  $('waiting').classList.toggle('on', state === PlayerState.BUFFERING);
  $('paused').classList.toggle('on', state === PlayerState.PAUSED);
  const up = barVisible(state, shownAt, Date.now());
  $('bar').classList.toggle('on', up);
  if (!up) return;
  const { position, length } = fileTimes(target, ...now());
  $('position').textContent = formatTime(position);
  $('length').textContent = length > 0 ? formatTime(length) : '';
  $('played').style.width = length > 0 ? `${Math.min(100, (position / length) * 100)}%` : '0';
};
if (EventType.MEDIA_STATUS) player.addEventListener(EventType.MEDIA_STATUS, render);
setInterval(render, 500);

setInterval(() => {
  if (player.getPlayerState() === PlayerState.PLAYING) saver.tick(...now());
}, 1000);
player.addEventListener(EventType.PAUSE, () => saver.save(...now()));
player.addEventListener(EventType.MEDIA_FINISHED, (event) => {
  const time = typeof event.currentMediaTime === 'number' ? event.currentMediaTime : player.getCurrentTimeSec();
  saver.finish(time, player.getDurationSec(), event.endedReason === cast.framework.events.EndedReason.END_OF_STREAM);
});

context.start();
