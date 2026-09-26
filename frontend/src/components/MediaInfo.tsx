import type { ReactNode } from 'react';
import type { MediaFileInfo, Replacement } from '../lib/types';
import { codecName, formatBytes, formatClock, formatRelative, resolutionLabel, snapshotLabel } from '../lib/format';
import { audioLines, subtitleLines, technicalSummary, type DetailLine } from '../lib/media-details';
import { useT } from '../i18n';

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink/90">{children}</dd>
    </div>
  );
}

/** A titled card on a detail page ("Audio", "Subtitles", "Technical", …). */
export function InfoSection({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`panel p-5 ${className}`}>
      <h3 className="mb-3 font-display text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Lines({ lines, empty }: { lines: DetailLine[]; empty: string }) {
  if (!lines.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2 text-sm">
      {lines.map((l, i) => (
        <li key={i}>
          <span className="block text-ink/90">{l.label}</span>
          {l.note && <span className="block text-xs text-muted">{l.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Audio, subtitles and technical details of a media file, from what the library scan stored
 * (opening a page never analyses the file again).
 */
export function MediaInfo({ file, replacements = [] }: { file: MediaFileInfo; replacements?: Replacement[] }) {
  const { t } = useT();
  const res = resolutionLabel(file.width, file.height);
  const summary = technicalSummary(file);
  return (
    <>
      <InfoSection title={t('playback.audio')}>
        <Lines lines={audioLines(file)} empty={t('mediaInfo.noAudio')} />
      </InfoSection>
      <InfoSection title={t('playback.subtitles')}>
        <Lines lines={subtitleLines(file)} empty={t('mediaInfo.noSubtitles')} />
      </InfoSection>
      <InfoSection title={t('mediaInfo.technical')} className="sm:col-span-2">
        {summary.length > 0 && (
          <ul aria-label={t('mediaInfo.videoFormat')} className="mb-3 flex flex-wrap gap-2">
            {summary.map((s) => (
              <li key={s} className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ink/85">
                {s}
              </li>
            ))}
          </ul>
        )}
        <dl className="divide-y divide-line/50">
          {file.probeError && <Row label={t('mediaInfo.problem')}>{<span className="text-danger">{file.probeError}</span>}</Row>}
          <Row label={t('playback.video')}>
            {[codecName(file.videoCodec), file.videoProfile, file.width && file.height ? `${file.width}×${file.height}${res ? ` (${res})` : ''}` : null, file.fps ? `${Number(file.fps.toFixed(3))} fps` : null]
              .filter(Boolean)
              .join(', ')}
          </Row>
          <Row label={t('mediaInfo.duration')}>{file.durationSec ? formatClock(file.durationSec) : null}</Row>
          <Row label={t('playback.container')}>{file.container?.toUpperCase()}</Row>
          <Row label={t('mediaInfo.size')}>{formatBytes(file.size)}</Row>
          <Row label={t('mediaInfo.file')}>{file.fileName}</Row>
          {replacements.length > 0 && (
            <Row label={t('mediaInfo.replaced')}>
              {replacements.map((r) => (
                <span key={r.at} className="block" title={`${r.previous.name} → ${r.current.name}`}>
                  <span className="text-muted">{formatRelative(r.at)}:</span> {snapshotLabel(r.previous)} → {snapshotLabel(r.current)}
                </span>
              ))}
              <span className="mt-1 block text-xs text-faint">{t('mediaInfo.historyKept')}</span>
            </Row>
          )}
        </dl>
      </InfoSection>
    </>
  );
}
