import path from 'node:path';
import { FRAME_SEC, longestCommonSegment, soundRatio, type Fingerprint } from './fingerprint.js';
import { detectSeason, type EpisodeAudio } from './detect.js';

/** Match strictness levels tried per pair: what detection uses, and two looser ones for comparison. */
const LEVELS = [
  { name: 'used', maxMeanBits: 13, minSec: 10 },
  { name: 'looser', maxMeanBits: 15, minSec: 5 },
  { name: 'loosest', maxMeanBits: 17, minSec: 3 },
] as const;

export interface PairResult {
  peer: number;
  /** Per strictness level: the longest common part, or null. Times are seconds in this episode. */
  intro: ({ start: number; end: number; ratio: number } | null)[];
  credits: ({ start: number; end: number; ratio: number } | null)[];
}

export interface EpisodeDiagnosis {
  episodeNumber: number;
  file: string;
  audio: string;
  audioTracks: number;
  duration: number | null;
  error: string | null;
  /** Share of the analysed windows that has sound (not silence). */
  headSound: number | null;
  tailSound: number | null;
  /** Intro/credits chapters in the file, and credits recognised in the picture. */
  chapters: string;
  picture: string;
  pairs: PairResult[];
  result: { intro: string; credits: string; postCredits: string } | null;
}

export interface SeasonDiagnosis {
  levels: typeof LEVELS;
  episodes: EpisodeDiagnosis[];
}

const round = (n: number) => Math.round(n * 10) / 10;

function best(a: Fingerprint, b: Fingerprint, offset: number) {
  return LEVELS.map((l) => {
    const seg = longestCommonSegment(a, b, { minFrames: Math.round(l.minSec / FRAME_SEC), maxFrames: Math.round(600 / FRAME_SEC), maxMeanBits: l.maxMeanBits });
    return seg ? { start: round(offset + seg.aStart * FRAME_SEC), end: round(offset + seg.aEnd * FRAME_SEC), ratio: Math.round(seg.ratio * 100) / 100 } : null;
  });
}

/** Everything the detector sees for one season, compared pair by pair at several strictness levels. */
export function diagnoseSeason(files: { id: number; episodeNumber: number; path: string; audio: string; audioTracks: number; error: string | null }[], audio: EpisodeAudio[]): SeasonDiagnosis {
  const byId = new Map(audio.map((a) => [a.id, a]));
  const results = detectSeason(audio, { intro: [], credits: [] });
  const span = (s: { start: number; end: number } | null) => (s ? `${round(s.start)}–${round(s.end)}` : '—');
  const part = (s: { start: number; end: number; confidence?: string; source?: string } | null) => (s ? `${span(s)}${s.confidence ? ` (${s.confidence}${s.source ? `, ${s.source}` : ''})` : ''}` : '—');
  return {
    levels: LEVELS,
    episodes: files.map((f) => {
      const a = byId.get(f.id);
      const index = audio.findIndex((x) => x.id === f.id);
      const peers = a
        ? audio
            .map((p, i) => ({ p, dist: Math.abs(i - index) }))
            .filter((x) => x.dist > 0)
            .sort((x, y) => x.dist - y.dist)
            .slice(0, 4)
            .map((x) => x.p)
        : [];
      const r = results.get(f.id);
      return {
        episodeNumber: f.episodeNumber,
        file: path.basename(f.path),
        audio: f.audio,
        audioTracks: f.audioTracks,
        duration: a ? round(a.duration) : null,
        error: f.error,
        headSound: a ? Math.round(soundRatio(a.head, 0, a.head.words.length) * 100) / 100 : null,
        tailSound: a ? Math.round(soundRatio(a.tail, 0, a.tail.words.length) * 100) / 100 : null,
        chapters: !a?.chapters ? 'not read' : [a.chapters.intro && `intro ${span(a.chapters.intro)}`, a.chapters.credits && `credits ${span(a.chapters.credits)}`, a.chapters.postCredits && `after ${span(a.chapters.postCredits)}`].filter(Boolean).join(', ') || 'none named intro/credits',
        picture: a?.visual === undefined ? 'not analysed' : a.visual ? `credits ${span(a.visual)} (${a.visual.confidence})${a.visual.postCredits ? `, scene after ${span(a.visual.postCredits)}` : ''}` : 'no credits recognised',
        pairs: a
          ? peers.map((p) => ({
              peer: files.find((x) => x.id === p.id)?.episodeNumber ?? p.id,
              intro: best(a.head, p.head, 0),
              credits: best(a.tail, p.tail, a.tailStart),
            }))
          : [],
        result: r ? { intro: part(r.intro), credits: part(r.credits), postCredits: span(r.postCredits) } : null,
      };
    }),
  };
}

/** Plain-text report, short enough to paste into a message. */
export function formatDiagnosis(title: string, season: number, d: SeasonDiagnosis): string {
  const lines = [`${title} — season ${season}`, `Levels: ${d.levels.map((l) => `${l.name} (≤${l.maxMeanBits} bits, ≥${l.minSec}s)`).join(', ')}`, ''];
  const cell = (x: { start: number; end: number; ratio: number } | null) => (x ? `${x.start}-${x.end} ${Math.round(x.ratio * 100)}%` : '-');
  for (const e of d.episodes) {
    lines.push(`E${String(e.episodeNumber).padStart(2, '0')} ${e.file} | ${e.duration ?? '?'}s | audio ${e.audio}${e.audioTracks > 1 ? ` (+${e.audioTracks - 1} more)` : ''} | sound head ${e.headSound ?? '?'} tail ${e.tailSound ?? '?'}`);
    if (e.error) lines.push(`  ERROR ${e.error}`);
    else lines.push(`  chapters: ${e.chapters} | picture: ${e.picture}`);
    for (const p of e.pairs) lines.push(`  vs E${String(p.peer).padStart(2, '0')}  intro ${p.intro.map(cell).join(' / ')}  |  credits ${p.credits.map(cell).join(' / ')}`);
    if (e.result) lines.push(`  => intro ${e.result.intro}  credits ${e.result.credits}  after ${e.result.postCredits}`);
  }
  return lines.join('\n');
}
