import { ProgressSaver, progressTarget } from './progress.js';

/**
 * Vidalune's cast player (cast.vidalune.com, app id 920BF057): Google's receiver framework with
 * Vidalune's colours, that saves where the TV is itself (see progress.js).
 */
const context = cast.framework.CastReceiverContext.getInstance();
const player = context.getPlayerManager();
const { MessageType, PlayerState, HlsSegmentFormat, HlsVideoSegmentFormat } = cast.framework.messages;
const { EventType } = cast.framework.events;

const saver = new ProgressSaver((url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }),
);
const now = () => [player.getCurrentTimeSec(), player.getDurationSec()];

player.setMessageInterceptor(MessageType.LOAD, (request) => {
  // What played before is saved first.
  saver.finish(...now());
  const media = request.media;
  // Repackaged titles come as HLS with fMP4 pieces (init.mp4 and .m4s).
  if (media && /mpegurl/i.test(media.contentType ?? '')) {
    media.hlsSegmentFormat = HlsSegmentFormat.FMP4;
    media.hlsVideoSegmentFormat = HlsVideoSegmentFormat.FMP4;
  }
  saver.start(progressTarget(media?.customData));
  return request;
});

setInterval(() => {
  if (player.getPlayerState() === PlayerState.PLAYING) saver.tick(...now());
}, 1000);
player.addEventListener(EventType.PAUSE, () => saver.save(...now()));
player.addEventListener(EventType.MEDIA_FINISHED, (event) => {
  const time = typeof event.currentMediaTime === 'number' ? event.currentMediaTime : player.getCurrentTimeSec();
  saver.finish(time, player.getDurationSec(), event.endedReason === cast.framework.events.EndedReason.END_OF_STREAM);
});

context.start();
