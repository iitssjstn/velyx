import { useEffect, useRef, useState } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import { channelLabel, resolutionLabel } from '../lib/format';
import type { PlaybackAnalysis } from '../lib/types';

/** Short label for the player: "Direct Play", "Remux • Audio converted to AAC", … */
export function modeLabel(a: PlaybackAnalysis): string {
  if (a.mode === 'direct') return 'Direct Play';
  if (a.mode === 'unsupported') return 'Not supported';
  return a.audio.action === 'convert' ? 'Remux • Audio converted to AAC' : 'Remux';
}

function videoLine(a: PlaybackAnalysis): string {
  const v = a.video;
  return [v.label, resolutionLabel(v.width, v.height) ?? (v.width && v.height ? `${v.width}×${v.height}` : null), v.bitDepth && v.bitDepth > 8 ? `${v.bitDepth}-bit` : null, v.range && v.range !== 'SDR' ? (v.range === 'DV' ? 'Dolby Vision' : v.range) : null]
    .filter(Boolean)
    .join(' • ');
}

const VIDEO_ACTION: Record<PlaybackAnalysis['video']['action'], string> = {
  direct: 'played as-is',
  copy: 'copied without re-encoding',
  unsupported: 'cannot be decoded here',
};

function audioLine(a: PlaybackAnalysis): string {
  const au = a.audio;
  if (au.action === 'none') return 'No audio';
  const source = [au.label, channelLabel(au.channels)].filter(Boolean).join(' ');
  if (au.action === 'convert') return `${source} → ${au.target}`;
  return `${source} — ${au.action === 'copy' ? 'copied' : 'played as-is'}`;
}

/** Key/value overview of how a file is delivered, for the player's info panel. */
export function PlaybackSummary({ analysis: a }: { analysis: PlaybackAnalysis }) {
  const rows: Array<[string, string]> = [
    ['Mode', a.mode === 'direct' ? 'Direct Play' : a.mode === 'remux' ? 'Remux' : 'Not supported'],
    ['Video', `${videoLine(a)} — ${VIDEO_ACTION[a.video.action]}`],
    ['Audio', audioLine(a)],
    ['Container', `${(a.container.name ?? 'unknown').toUpperCase()}${a.container.action === 'remux' ? ' → fragmented MP4' : ''}`],
    ['Server transcoding', 'No'],
  ];
  if (a.browser) rows.push(['Browser', a.browser]);
  return (
    <div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="text-ink/90">{v}</dd>
          </div>
        ))}
      </dl>
      {a.mode === 'remux' && <p className="mt-3 text-xs text-muted">Remuxing only repackages the file{a.audio.action === 'convert' ? ' and converts the audio' : ''}; it uses little CPU on the server.</p>}
      {a.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber/90">
          {a.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Subtle status chip in the player's top bar; opens the playback details. */
export function PlaybackBadge({ analysis }: { analysis: PlaybackAnalysis }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative ml-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex max-w-[60vw] items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-ink/80 hover:bg-white/15 hover:text-ink"
      >
        <Info className="size-3.5 shrink-0" />
        <span className="truncate">{modeLabel(analysis)}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Playback details" className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface/95 p-4 shadow-2xl backdrop-blur">
          <p className="mb-3 font-display text-base font-semibold">Playback</p>
          <PlaybackSummary analysis={analysis} />
        </div>
      )}
    </div>
  );
}

/**
 * Explains why a file cannot play on this device, before (or instead of) a failed attempt.
 * `onTryAnyway` is offered because browsers sometimes under-report what they can decode.
 */
export function PlaybackUnavailable({
  analysis: a,
  onBack,
  onTryAnyway,
  onNext,
}: {
  analysis: PlaybackAnalysis;
  onBack: () => void;
  onTryAnyway?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-black/90 px-5 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface/90 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <TriangleAlert className="size-6 shrink-0 text-amber" />
          <h2 className="font-display text-2xl font-semibold">Playback unavailable</h2>
        </div>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
          <dt className="text-faint">Video</dt>
          <dd>{videoLine(a)}</dd>
          <dt className="text-faint">Audio</dt>
          <dd>{a.audio.action === 'none' ? 'None' : [a.audio.label, channelLabel(a.audio.channels)].filter(Boolean).join(' ')}</dd>
          {a.browser && (
            <>
              <dt className="text-faint">Browser</dt>
              <dd>{a.browser}</dd>
            </>
          )}
        </dl>
        <div className="mt-5 rounded-xl bg-raised/60 px-4 py-3 text-sm">
          <p className="font-medium">Problem</p>
          <ul className="mt-1 space-y-1 text-ink/85">
            {a.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-sm text-muted">
          {a.transcodeRequired
            ? 'Playing this file here would need the video to be converted (transcoded). Velyx does not transcode video, to keep the server light — '
            : ''}
          Try a browser or device that supports this format{a.video.codec === 'hevc' ? ', such as Safari, or Edge/Chrome on a PC with HEVC hardware decoding' : ''}.
        </p>
        {a.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber/90">
            {a.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {onTryAnyway && (
            <button type="button" onClick={onTryAnyway} className="h-10 rounded-lg px-4 text-muted hover:bg-raised hover:text-ink">
              Try anyway
            </button>
          )}
          {onNext && (
            <button type="button" onClick={onNext} className="h-10 rounded-lg bg-raised px-4">
              Next episode
            </button>
          )}
          <button type="button" onClick={onBack} className="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}
