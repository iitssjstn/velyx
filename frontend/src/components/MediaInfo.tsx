import type { MediaFileInfo, Replacement } from '../lib/types';
import { channelLabel, codecName, formatBitrate, formatBytes, formatClock, formatRelative, resolutionLabel, snapshotLabel } from '../lib/format';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink/90">{children}</dd>
    </div>
  );
}

/** Technical details of a media file as reported by FFprobe. */
export function MediaInfo({ file, replacements = [] }: { file: MediaFileInfo; replacements?: Replacement[] }) {
  const res = resolutionLabel(file.width, file.height);
  const subs = [
    ...file.externalSubtitles.map((s) => `${s.label}${s.forced ? ' (forced)' : ''} — ${s.format.toUpperCase()}`),
    ...file.embeddedSubtitles.map((s) => `${s.languageName ?? s.title ?? 'Unknown'} — ${codecName(s.codec)}${s.textBased ? '' : ' (image-based, not shown)'}`),
  ];
  return (
    <dl className="divide-y divide-line/50">
      <Row label="File">{file.fileName}</Row>
      {file.probeError && <Row label="Problem">{<span className="text-danger">{file.probeError}</span>}</Row>}
      <Row label="Video">
        {[codecName(file.videoCodec), file.videoProfile, file.width && file.height ? `${file.width}×${file.height}${res ? ` (${res})` : ''}` : null, file.fps ? `${Number(file.fps.toFixed(3))} fps` : null]
          .filter(Boolean)
          .join(', ')}
      </Row>
      <Row label="Audio">
        {file.audioTracks.length > 0
          ? file.audioTracks.map((a) => (
              <span key={a.index} className="block">
                {[a.languageName ?? a.title ?? 'Unknown', codecName(a.codec), channelLabel(a.channels)].filter(Boolean).join(' — ')}
                {a.isDefault && file.audioTracks.length > 1 ? ' (default)' : ''}
              </span>
            ))
          : null}
      </Row>
      <Row label="Subtitles">{subs.length ? subs.map((s) => <span key={s} className="block">{s}</span>) : null}</Row>
      <Row label="Duration">{file.durationSec ? formatClock(file.durationSec) : null}</Row>
      <Row label="Bitrate">{formatBitrate(file.bitrate)}</Row>
      <Row label="Container">{file.container?.toUpperCase()}</Row>
      <Row label="Size">{formatBytes(file.size)}</Row>
      {replacements.length > 0 && (
        <Row label="Replaced">
          {replacements.map((r) => (
            <span key={r.at} className="block" title={`${r.previous.name} → ${r.current.name}`}>
              <span className="text-muted">{formatRelative(r.at)}:</span> {snapshotLabel(r.previous)} → {snapshotLabel(r.current)}
            </span>
          ))}
          <span className="mt-1 block text-xs text-faint">Watch history was kept.</span>
        </Row>
      )}
    </dl>
  );
}
