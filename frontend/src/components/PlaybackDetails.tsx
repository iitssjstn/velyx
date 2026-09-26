import { useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, Info, TriangleAlert, X } from 'lucide-react';
import { channelLabel, resolutionLabel } from '../lib/format';
import type { ComponentStatus, PlaybackAnalysis } from '../lib/types';

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

function audioLine(a: PlaybackAnalysis): string {
  if (a.audio.action === 'none' && !a.audio.codec) return 'None';
  return [a.audio.label, channelLabel(a.audio.channels)].filter(Boolean).join(' ');
}

const STATUS: Record<ComponentStatus, { icon: typeof Check; className: string; label: string }> = {
  ok: { icon: Check, className: 'text-ok', label: 'Supported' },
  warn: { icon: TriangleAlert, className: 'text-amber', label: 'Converted' },
  fail: { icon: X, className: 'text-danger', label: 'Not supported' },
  unknown: { icon: CircleHelp, className: 'text-muted', label: 'Not certain' },
};

function StatusIcon({ status }: { status: ComponentStatus }) {
  const { icon: Icon, className, label } = STATUS[status];
  return <Icon className={`size-4 shrink-0 ${className}`} strokeWidth={2.5} role="img" aria-label={label} />;
}

/** Video / Audio / Container, each with what it is, whether this device handles it and what happens to it. */
export function StreamRows({ analysis: a }: { analysis: PlaybackAnalysis }) {
  const rows: Array<[string, string, PlaybackAnalysis['components']['video']]> = [
    ['Video', videoLine(a), a.components.video],
    ['Audio', audioLine(a), a.components.audio],
    ['Container', (a.container.name ?? 'unknown').toUpperCase(), a.components.container],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr_auto] items-start gap-x-4 gap-y-2.5 text-sm">
      {rows.map(([name, value, c]) => (
        <div key={name} className="contents">
          <dt className="text-faint">{name}</dt>
          <dd className="min-w-0">
            <span className="block text-ink/90">{value}</span>
            <span className="block text-xs text-muted">{c.note}</span>
          </dd>
          <dd className="pt-0.5">
            <StatusIcon status={c.status} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

const MODE_TITLE: Record<PlaybackAnalysis['mode'], string> = { direct: 'Direct Play', remux: 'Remux', unsupported: 'Playback unavailable' };

/** Overview of how a file is delivered, for the player's info panel. */
export function PlaybackSummary({ analysis: a }: { analysis: PlaybackAnalysis }) {
  return (
    <div>
      <p className="mb-3 font-display text-base font-semibold">{MODE_TITLE[a.mode]}</p>
      <StreamRows analysis={a} />
      <div className="mt-3 space-y-1 text-sm text-ink/85">
        {a.summary.map((s) => (
          <p key={s}>{s}</p>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted">
        {a.mode !== 'unsupported' && (
          <>
            <dt>Server transcoding</dt>
            <dd>No</dd>
          </>
        )}
        {(a.device ?? a.browser) && (
          <>
            <dt>Device</dt>
            <dd>{a.device ?? a.browser}</dd>
          </>
        )}
      </dl>
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
        <div role="dialog" aria-label="Playback details" className="absolute right-0 z-30 mt-2 max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-surface/95 p-4 shadow-2xl backdrop-blur">
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
        <div className="mt-5">
          <StreamRows analysis={a} />
        </div>
        <div className="mt-5 space-y-1 rounded-xl bg-raised/60 px-4 py-3 text-sm">
          {a.summary.map((s) => (
            <p key={s} className="text-ink/90">{s}</p>
          ))}
        </div>
        {a.problems.some((p) => p !== a.components.video.note) && (
          <ul className="mt-3 space-y-1 text-sm text-ink/80">
            {a.problems.filter((p) => p !== a.components.video.note).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm text-muted">
          {a.device ? `Current device: ${a.device}. ` : ''}
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
