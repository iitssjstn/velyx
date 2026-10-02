import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SubtitleOverlay } from './SubtitleOverlay';
import { DEFAULT_PREFS } from '../lib/prefs';

/** A text track with these cues (what the browser gives once the WebVTT file is loaded). */
function track(cues: { startTime: number; endTime: number; text: string }[]): TextTrack {
  return { cues: Object.assign([...cues], { getCueById: () => null }) } as unknown as TextTrack;
}

const frame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));

describe('SubtitleOverlay', () => {
  it('drops the previous language at once when another subtitle is chosen', async () => {
    const video = { currentTime: 10 } as HTMLVideoElement;
    const english = track([{ startTime: 9, endTime: 12, text: 'Hello there' }]);
    const view = render(<SubtitleOverlay video={video} track={english} delay={0} prefs={DEFAULT_PREFS} controlsVisible={false} />);
    await frame();
    expect(screen.getByText('Hello there')).toBeTruthy();

    // Dutch is chosen; its cues are still loading (none yet). The English line must not stay up.
    const dutch = track([]);
    view.rerender(<SubtitleOverlay video={video} track={dutch} delay={0} prefs={DEFAULT_PREFS} controlsVisible={false} />);
    await frame();
    expect(screen.queryByText('Hello there')).toBeNull();

    // Once loaded, the Dutch line shows.
    (dutch.cues as unknown as unknown[]).push({ startTime: 9, endTime: 12, text: 'Hallo daar' });
    await frame();
    expect(screen.getByText('Hallo daar')).toBeTruthy();
  });
});
