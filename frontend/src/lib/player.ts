import type { PlaybackInfo, SubtitleOption } from './types';
import { sameLanguage } from './prefs';
import { languageLabel, t } from '../i18n';

/** Where playback should start: explicit ?t= wins, then saved progress (unless finished or at the very end). */
export function startPosition(tParam: string | null, progress: { positionSec: number; durationSec: number; completed: boolean } | null | undefined): number {
  if (tParam !== null) {
    const t = Number(tParam);
    return Number.isFinite(t) && t > 0 ? t : 0;
  }
  return resumePoint(progress) ?? 0;
}

/**
 * Where playback can resume, or null: from 30 seconds in until the last part. A watched item that is
 * being watched again has a resume point too (the server resets it once a play is finished).
 */
export function resumePoint(progress: { positionSec: number; durationSec: number } | null | undefined): number | null {
  if (!progress || progress.positionSec < 30) return null;
  if (progress.durationSec > 0 && (progress.durationSec - progress.positionSec < 15 || progress.positionSec / progress.durationSec >= 0.9)) return null;
  return progress.positionSec;
}

/**
 * Link to play an item. With a saved position the link resumes there directly (?t=), so the
 * player does not ask "Resume or start over?" after the viewer already chose Resume.
 */
export function playHref(kind: 'movie' | 'episode', id: number, resumeAt?: number | null, fileId?: number | null): string {
  const q = new URLSearchParams();
  if (resumeAt && resumeAt > 0) q.set('t', String(Math.floor(resumeAt)));
  if (fileId) q.set('file', String(fileId));
  const qs = q.toString();
  return `/play/${kind}/${id}${qs ? `?${qs}` : ''}`;
}

export interface SubtitleChoice {
  language: string;
  forced?: boolean;
  label?: string;
}

/**
 * Picks the subtitle to enable at start, based on what the viewer chose last time:
 * 1. a subtitle in that language (full or forced, whichever was chosen; the other as fallback),
 * 2. for untagged tracks: one with the same label,
 * 3. otherwise a forced track (foreign-language parts) if the file flags one as default,
 * 4. otherwise none.
 */
export function pickSubtitle(options: SubtitleOption[], choice: SubtitleChoice | string): string | null {
  const c = typeof choice === 'string' ? { language: choice } : choice;
  if (c.language) {
    const lang = options.filter((o) => sameLanguage(o.language, c.language));
    const match = lang.find((o) => o.forced === Boolean(c.forced)) ?? lang[0];
    if (match) return match.key;
  } else if (c.label) {
    const byLabel = options.find((o) => o.label === c.label);
    if (byLabel) return byLabel.key;
  }
  const forced = options.find((o) => o.forced && o.isDefault);
  return forced?.key ?? null;
}

/** True when the given element is focused in a way where keyboard shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return Boolean(t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)));
}

/** Appends a query parameter to a URL that may already have a query string. */
export function withParam(url: string, key: string, value: string | number): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(String(value))}`;
}

export async function selectDirectPlayback(info: PlaybackInfo, pageOrigin: string, fetchImpl: typeof fetch = fetch): Promise<PlaybackInfo> {
  const page = new URL(pageOrigin);
  const hostedApp = page.hostname.toLowerCase() === 'app.vidalune.com';
  const unavailable = () => {
    if (hostedApp) throw new Error(t('player.errors.directServerRequired'));
    return info;
  };
  const direct = info.directPlayback;
  if (!direct?.baseUrls.length) return unavailable();
  for (const candidate of direct.baseUrls) {
    let base: URL;
    try {
      base = new URL(candidate);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(base.protocol)) continue;
    if (base.origin === page.origin) {
      if (!hostedApp) return info;
      continue;
    }
    const probe = new URL(`/api/media/${info.file.id}/stream`, base.origin);
    if (info.decision.optimized) probe.searchParams.set('optimized', String(info.decision.optimized.id));
    probe.searchParams.set('cast', direct.token);
    try {
      const response = await fetchImpl(probe, { method: 'HEAD', mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(4000) });
      if (!response.ok) continue;
    } catch {
      continue;
    }
    const withToken = (path: string) => {
      const url = new URL(path, `${base.origin}/`);
      url.searchParams.set('cast', direct.token);
      return url.toString();
    };
    return {
      ...info,
      decision: {
        ...info.decision,
        streamUrl: withToken(info.decision.streamUrl),
        ...(info.decision.hlsUrl ? { hlsUrl: withToken(info.decision.hlsUrl) } : {}),
      },
    };
  }
  return unavailable();
}

/**
 * The audio track to request up front: the preferred language when the browser cannot switch
 * tracks itself and that language is not already the default. undefined = file default.
 */
export function preferredAudioIndex(
  tracks: { index: number; language: string | null; isDefault: boolean }[],
  preferredLanguage: string,
  nativeSwitching: boolean,
): number | undefined {
  if (!preferredLanguage || nativeSwitching || tracks.length < 2) return undefined;
  const def = tracks.find((t) => t.isDefault) ?? tracks[0];
  if (def && sameLanguage(def.language, preferredLanguage)) return undefined;
  return tracks.find((t) => sameLanguage(t.language, preferredLanguage))?.index;
}

export type SubtitleMode = 'remember' | 'always' | 'foreign' | 'forced' | 'off';

/** Playback language preferences stored with the account (see /api/account/preferences). */
export interface LanguagePreferences {
  audioLanguage: string;
  subtitleLanguage: string;
  subtitleFallback: string;
  subtitleMode: SubtitleMode;
  /** Detected intros / credits: never offer skipping, offer a button, or skip automatically. */
  skipIntro?: SkipMode;
  skipCredits?: SkipMode;
  /** Recaps ("previously on"); servers before 0.11.0 have none (then the intro's applies). */
  skipRecap?: SkipMode;
}

/**
 * The subtitle to enable when playback starts, from the account's preferences:
 * - remember: the viewer's last choice in this browser (pickSubtitle);
 * - always: a full subtitle in the preferred language, else the fallback language;
 * - foreign: like always, but when the audio already is in the preferred language only a forced
 *   track (translations of foreign-language parts) is shown;
 * - forced: only forced tracks, in the preferred language or the audio's language;
 * - off: none.
 * Manual changes in the player always take precedence for that session.
 */
export function initialSubtitle(options: SubtitleOption[], prefs: LanguagePreferences, remembered: SubtitleChoice, audioLanguage: string | null): string | null {
  const lang = (code: string, forced: boolean) => (code ? options.find((o) => sameLanguage(o.language, code) && o.forced === forced)?.key : undefined);
  const full = (code: string) => lang(code, false) ?? (code ? options.find((o) => sameLanguage(o.language, code))?.key : undefined);
  switch (prefs.subtitleMode) {
    case 'off':
      return null;
    case 'forced':
      return lang(prefs.subtitleLanguage, true) ?? lang(audioLanguage ?? '', true) ?? options.find((o) => o.forced && o.isDefault)?.key ?? null;
    case 'foreign':
      if (prefs.subtitleLanguage && sameLanguage(audioLanguage, prefs.subtitleLanguage)) return lang(prefs.subtitleLanguage, true) ?? null;
      return full(prefs.subtitleLanguage) ?? full(prefs.subtitleFallback) ?? null;
    case 'always':
      return full(prefs.subtitleLanguage) ?? full(prefs.subtitleFallback) ?? null;
    default:
      return pickSubtitle(options, remembered);
  }
}

export type SkipMode = 'never' | 'ask' | 'always';

export interface SegmentSpan {
  start: number;
  end: number;
  /** How sure the detection is (manual corrections: high); older servers send none. */
  confidence?: 'high' | 'medium';
}

/** Recap, intro and credits of an episode (only confident or manually set ones come from the server). */
export interface EpisodeSegments {
  fileId: number | null;
  /** A recap ("previously on") before the intro (servers before 0.11.0 send none). */
  recap?: SegmentSpan | null;
  intro: SegmentSpan | null;
  credits: SegmentSpan | null;
  postCredits: SegmentSpan | null;
  manual: boolean;
}

export interface SkipAction {
  kind: 'recap' | 'intro' | 'credits';
  /** Where "skip" goes: the end of the intro, or the post-credits scene / end of the credits. */
  to: number;
  /** Credits with nothing after them: skipping may go straight to the next episode. */
  toNext: boolean;
  mode: 'ask' | 'always';
}

/** A skip button stays up at least this long, so it never vanishes before it can be pressed. */
const MIN_VISIBLE = 5;

/**
 * When the skip button for a part is shown: a moment after the detected start (the detection may
 * be a second or two early; less sure, a little later), until just before its end.
 */
export function skipWindow(s: SegmentSpan): { from: number; until: number } {
  const margin = s.confidence === 'medium' ? 2 : s.confidence === 'high' ? 1 : 0;
  const until = s.end - 1;
  const from = Math.max(s.start, Math.min(s.start + margin, until - MIN_VISIBLE));
  return { from, until };
}

/**
 * The skip offered at `time`, if any. Segments measured on another version of the episode are
 * ignored (its cut may differ). A post-credits scene is never skipped: skipping the credits lands
 * at its start. Nothing is offered in the last second of a part (it is over by then anyway).
 * A recap follows the intro's preference when none is given for it.
 */
export function skipAt(segments: EpisodeSegments | null | undefined, fileId: number | null | undefined, time: number, modes: { recap?: SkipMode; intro: SkipMode; credits: SkipMode }): SkipAction | null {
  if (!segments || (segments.fileId !== null && fileId != null && segments.fileId !== fileId)) return null;
  const inside = (s: SegmentSpan | null | undefined): s is SegmentSpan => {
    if (!s) return false;
    const w = skipWindow(s);
    return time >= w.from && time < w.until;
  };
  const recapMode = modes.recap ?? modes.intro;
  if (recapMode !== 'never' && inside(segments.recap)) return { kind: 'recap', to: segments.recap.end, toNext: false, mode: recapMode };
  if (modes.intro !== 'never' && inside(segments.intro)) return { kind: 'intro', to: segments.intro.end, toNext: false, mode: modes.intro };
  if (modes.credits !== 'never' && inside(segments.credits)) {
    const post = segments.postCredits && segments.postCredits.start >= segments.credits.end - 1 ? segments.postCredits : null;
    return { kind: 'credits', to: post ? post.start : segments.credits.end, toNext: !post, mode: modes.credits };
  }
  return null;
}

/** Presses within this time of each other add up to one jump ("+30"). */
export const SEEK_COMBINE_MS = 900;

export interface PendingSeek {
  /** Where the jumps so far lead. */
  target: number;
  /** All jumps so far together (for "+30" / "−20"). */
  total: number;
  /** When the last press was. */
  at: number;
}

/**
 * One more press of back/forward: quick presses add up from where the previous one aimed (not from
 * where the video happens to be yet), within the start and end of the video.
 */
export function addSeek(pending: PendingSeek | null, now: number, current: number, delta: number, duration: number): PendingSeek {
  const base = pending && now - pending.at < SEEK_COMBINE_MS ? pending : null;
  const max = duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const target = Math.min(max, Math.max(0, (base?.target ?? current) + delta));
  return { target, total: (base?.total ?? 0) + delta, at: now };
}

/**
 * When the "Up next" card appears: at the start of the credits when nothing follows them, otherwise
 * (a post-credits scene, or unknown credits) only in the last seconds of the episode.
 */
export function upNextStart(segments: EpisodeSegments | null | undefined, fileId: number | null | undefined, duration: number, countdown: number): number | null {
  if (!(duration > 0)) return null;
  const fallback = Math.max(0, duration - Math.max(10, countdown + 2));
  const usable = segments && !(segments.fileId !== null && fileId != null && segments.fileId !== fileId);
  if (usable && segments.credits && !segments.postCredits && segments.credits.end >= duration - 5) return Math.min(fallback, segments.credits.start);
  return fallback;
}

/** Whether the end credits (with nothing after them) are playing: the "Next episode" card then offers *Watch credits*. */
export function creditsPlaying(segments: EpisodeSegments | null | undefined, fileId: number | null | undefined, time: number): boolean {
  if (!segments?.credits || (segments.fileId !== null && fileId != null && segments.fileId !== fileId)) return false;
  if (segments.postCredits && segments.postCredits.start >= segments.credits.end - 1) return false;
  return time >= segments.credits.start && time < segments.credits.end;
}

/**
 * A subtitle's name in the menu: its language in the interface language, plus its title when that
 * tells tracks of the same language apart ("English · SDH", "English · Commentary").
 */
export function subtitleName(s: Pick<SubtitleOption, 'language' | 'languageName' | 'title'>): string {
  const lang = languageLabel(s.language);
  const title = s.title?.trim() || null;
  if (!lang) return title ?? t('media.unknownLanguage');
  const same = [lang, s.languageName].some((n) => n && title && n.toLowerCase() === title.toLowerCase());
  return title && !same ? `${lang} · ${title}` : lang;
}
