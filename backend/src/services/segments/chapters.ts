/** Chapter markers named like an intro or credits: the most reliable source when a file has them. */

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

export interface ChapterSegments {
  intro: { start: number; end: number } | null;
  credits: { start: number; end: number } | null;
  postCredits: { start: number; end: number } | null;
}

const INTRO = /^(intro|introduction|opening|opening (credits|titles|theme)|title sequence|main titles|op)$/i;
const CREDITS = /^(credits|end credits|closing credits|ending( credits)?|end titles|closing|outro|ed)$/i;
const POST = /(post|after|mid)[ -]?credits?|stinger|end scene|bonus scene/i;

const clean = (title: string) => title.replace(/^\s*(chapter\s*)?\d+\s*[-.:]\s*/i, '').trim();

export function chapterSegments(chapters: Chapter[], duration: number): ChapterSegments {
  const out: ChapterSegments = { intro: null, credits: null, postCredits: null };
  for (const c of chapters) {
    const title = clean(c.title);
    if (!title || c.end <= c.start) continue;
    const span = { start: c.start, end: Math.min(c.end, duration) };
    if (POST.test(title)) out.postCredits ??= span;
    else if (INTRO.test(title) && c.start < duration * 0.5) out.intro ??= span;
    else if (CREDITS.test(title) && c.start > duration * 0.5) out.credits = span;
  }
  // Credits run until the post-credits scene, or to the end.
  if (out.credits && out.postCredits && out.postCredits.start < out.credits.start) out.postCredits = null;
  return out;
}

/** Parses `ffprobe -show_chapters -of json` output. */
export function parseChapters(json: string): Chapter[] {
  try {
    const data = JSON.parse(json) as { chapters?: { start_time?: string; end_time?: string; tags?: { title?: string } }[] };
    return (data.chapters ?? [])
      .map((c) => ({ start: Number(c.start_time), end: Number(c.end_time), title: c.tags?.title ?? '' }))
      .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end));
  } catch {
    return [];
  }
}
