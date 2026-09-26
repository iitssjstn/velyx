import type { MediaFileInfo } from './types';
import { languageLabel, t } from '../i18n';
import { channelLabel, codecName, formatBitrate, resolutionLabel } from './format';

/** How the dynamic range is named in a headline ("HDR") and in technical details ("HDR10"). */
export function rangeLabel(range: string | null | undefined, detailed = false): string | null {
  if (!range || range === 'SDR') return null;
  if (range === 'DV') return 'Dolby Vision';
  if (range === 'HDR10') return detailed ? 'HDR10' : 'HDR';
  return range;
}

/** "4K HDR", "1080p", "4K Dolby Vision"; null when the file was never analysed. */
export function qualityLabel(file: Pick<MediaFileInfo, 'width' | 'height' | 'videoRange'> | null | undefined): string | null {
  if (!file) return null;
  return [resolutionLabel(file.width, file.height), rangeLabel(file.videoRange)].filter(Boolean).join(' ') || null;
}

export interface DetailLine {
  /** "English 5.1" / "Dutch". */
  label: string;
  /** "Dolby Digital+ · Default" / "PGS · image-based, not shown". */
  note: string | null;
}

/** A track's language in the interface language, or its title, or "Unknown language". */
function trackName(track: { language: string | null; languageName: string | null; title: string | null }): string {
  return languageLabel(track.language) ?? track.languageName ?? track.title ?? t('media.unknownLanguage');
}

/** A track's title when it adds something to its language ("Commentary", "SDH"). */
function extraTitle(track: { language: string | null; languageName: string | null; title: string | null }): string | null {
  if (!track.title || !(track.languageName || languageLabel(track.language))) return null;
  const same = [track.languageName, languageLabel(track.language)].some((n) => n && n.toLowerCase() === track.title!.toLowerCase());
  return same ? null : track.title;
}

/** Audio tracks in file order: language and channels first, the format after. */
export function audioLines(file: MediaFileInfo): DetailLine[] {
  const several = file.audioTracks.length > 1;
  return file.audioTracks.map((a) => ({
    label: [trackName(a), channelLabel(a.channels)].filter(Boolean).join(' '),
    note: [codecName(a.codec), extraTitle(a), several && a.isDefault ? t('media.default') : null].filter(Boolean).join(' · ') || null,
  }));
}

/** Subtitles: files next to the video first, then the ones inside it. Image-based ones cannot be shown. */
export function subtitleLines(file: MediaFileInfo): DetailLine[] {
  const external = file.externalSubtitles.map((s) => ({
    label: languageLabel(s.language) ?? s.label,
    note: [s.format.toUpperCase(), s.forced ? t('media.forced') : null, t('media.separateFile')].filter(Boolean).join(' · '),
  }));
  const embedded = file.embeddedSubtitles.map((s) => ({
    label: trackName(s),
    note: [codecName(s.codec), extraTitle(s), s.isForced ? t('media.forced') : null, s.textBased ? null : t('media.imageBasedNotShown')].filter(Boolean).join(' · ') || null,
  }));
  return [...external, ...embedded];
}

/** The headline technical facts, in the order people look for them: "HEVC", "10-bit", "HDR10", "24.0 Mbps". */
export function technicalSummary(file: MediaFileInfo): string[] {
  return [codecName(file.videoCodec), file.videoBitDepth ? `${file.videoBitDepth}-bit` : null, rangeLabel(file.videoRange, true) ?? (file.videoRange === 'SDR' ? 'SDR' : null), formatBitrate(file.bitrate)].filter(
    (x): x is string => Boolean(x),
  );
}
