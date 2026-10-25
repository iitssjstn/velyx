export interface Cue {
  start: number;
  end: number;
  text: string;
}

function seconds(t: string): number {
  const parts = t.trim().replace(',', '.').split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
}

/** Reads the cues of a WebVTT document (what the server sends for every subtitle). */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i === -1) continue;
    const [a, b] = lines[i]!.split('-->');
    const start = seconds(a ?? '');
    const end = seconds((b ?? '').trim().split(/\s+/)[0] ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const body = lines
      .slice(i + 1)
      .join('\n')
      // Styling tags (<i>, <b>, <c.yellow>, <v Name>) are dropped; the text stays.
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** The text on screen at `time` (overlapping cues are shown together). */
export function cueTextAt(cues: Cue[], time: number): string {
  const active: string[] = [];
  for (const c of cues) {
    if (c.start > time) break;
    if (time < c.end) active.push(c.text);
  }
  return active.join('\n');
}

/** How long a subtitle may take before the player says it is loading (a file the server has ready is in at once). */
export const SUBTITLE_LOADING_AFTER_MS = 600;
/** How long "could not be loaded" stays on the screen. */
export const SUBTITLE_ERROR_FOR_MS = 6000;

/**
 * The cues of a subtitle from the server's answer. A failed answer (the file could not be read) is an
 * error, not an empty subtitle: the player says it could not be loaded instead of showing nothing.
 */
export async function cuesFrom(res: { ok: boolean; status: number; text: () => Promise<string> }): Promise<Cue[]> {
  if (!res.ok) throw new Error(`Subtitle not loaded (${res.status})`);
  return parseVtt(await res.text());
}
