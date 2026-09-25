import { useEffect, useState } from 'react';
import { parseCueText, subtitleBottom, subtitleLineStyle, type CueSpan } from '../lib/subtitles';
import type { PlaybackPrefs } from '../lib/prefs';

/**
 * Draws subtitles ourselves instead of relying on the browser's cue rendering, so they are styled
 * the same in every browser, stay above the player controls, and can be shifted in time.
 * The text track is kept in "hidden" mode: the browser loads the cues, we decide when to show them.
 */
export function SubtitleOverlay({
  video,
  track,
  delay,
  prefs,
  controlsVisible,
}: {
  video: HTMLVideoElement | null;
  track: TextTrack | null;
  /** Seconds; positive shows subtitles later, negative earlier. */
  delay: number;
  prefs: PlaybackPrefs;
  controlsVisible: boolean;
}) {
  const [lines, setLines] = useState<{ key: string; spans: CueSpan[] }[]>([]);

  useEffect(() => {
    if (!video || !track) {
      setLines([]);
      return;
    }
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      const cues = track.cues;
      const t = video.currentTime - delay;
      const active: VTTCue[] = [];
      if (cues) {
        for (let i = 0; i < cues.length; i++) {
          const c = cues[i] as VTTCue;
          if (c.startTime <= t && c.endTime > t) active.push(c);
        }
      }
      const key = active.map((c) => `${c.startTime}-${c.text}`).join('|');
      if (key !== lastKey) {
        lastKey = key;
        setLines(active.flatMap((c, ci) => parseCueText(c.text).map((spans, li) => ({ key: `${c.startTime}-${ci}-${li}`, spans }))));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [video, track, delay]);

  if (!lines.length) return null;
  const style = subtitleLineStyle(prefs);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-[5] flex flex-col items-center gap-[0.15em] px-[6%] text-center transition-[bottom] duration-300"
      style={{ bottom: subtitleBottom(controlsVisible, prefs.subtitlePosition), fontSize: style.fontSize }}
      aria-live="off"
    >
      {lines.map((line) => (
        <div key={line.key} className="max-w-full">
          <span style={style}>
            {line.spans.map((s, i) => (
              <span key={i} style={{ fontStyle: s.italic ? 'italic' : undefined, fontWeight: s.bold ? 700 : undefined, textDecoration: s.underline ? 'underline' : undefined }}>
                {s.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
