import { describe, expect, it } from 'vitest';
import { parseCueText, subtitleBottom, subtitleLineStyle } from './subtitles';

describe('parseCueText', () => {
  it('keeps italic/bold/underline and splits lines', () => {
    expect(parseCueText('Hello <i>world</i>\n<b>Bold</b> &amp; <u>under</u>')).toEqual([
      [
        { text: 'Hello ', italic: false, bold: false, underline: false },
        { text: 'world', italic: true, bold: false, underline: false },
      ],
      [
        { text: 'Bold', italic: false, bold: true, underline: false },
        { text: ' & ', italic: false, bold: false, underline: false },
        { text: 'under', italic: false, bold: false, underline: true },
      ],
    ]);
  });

  it('drops voice, class and timestamp tags and never produces HTML', () => {
    const lines = parseCueText('<v Roger>Hi <c.loud>there</c><00:00:01.500> <script>x</script>');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.map((s) => s.text).join('')).toBe('Hi there x');
  });

  it('skips empty lines', () => {
    expect(parseCueText('\n[rat squeaking]\n')).toEqual([[{ text: '[rat squeaking]', italic: false, bold: false, underline: false }]]);
  });
});

describe('subtitle layout', () => {
  it('moves above the controls while they are visible', () => {
    expect(subtitleBottom(true, 0)).toBe('calc(7.5rem + 0%)');
    expect(subtitleBottom(false, 10)).toBe('calc(5% + 10%)');
    expect(subtitleBottom(false, 99)).toBe('calc(5% + 20%)');
  });

  it('maps preferences to styles', () => {
    const s = subtitleLineStyle({ subtitleSize: 'large', subtitleColor: 'yellow', subtitleBackground: 'solid', subtitleEdge: 'none' });
    expect(s.color).toBe('#ffe14d');
    expect(s.backgroundColor).toBe('rgba(0,0,0,0.92)');
    expect(s.textShadow).toBe('none');
  });
});
