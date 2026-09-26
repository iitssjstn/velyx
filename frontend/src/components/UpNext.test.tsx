import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpNext } from './UpNext';

const next = { id: 9, seasonNumber: 1, episodeNumber: 9, title: 'La Catedral', stillPath: '/still.jpg', overview: 'The case takes a turn.', runtime: 52, durationSec: 3100 };

function setup(props: Partial<Parameters<typeof UpNext>[0]> = {}) {
  const onPlay = vi.fn();
  const onStay = vi.fn();
  render(<UpNext next={next} countdown={7} countdownTotal={10} credits ended={false} onPlay={onPlay} onStay={onStay} {...props} />);
  return { onPlay, onStay };
}

describe('Next episode card', () => {
  it('shows what comes next: code, length, title and what it is about', () => {
    setup();
    const card = screen.getByRole('dialog', { name: 'Next episode' });
    expect(card.textContent).toContain('Next episode · S01E09 · 52m');
    expect(screen.getByText('La Catedral')).toBeTruthy();
    expect(screen.getByText('The case takes a turn.')).toBeTruthy();
  });

  it('offers Watch credits during the credits, and a Next episode button that fills while counting down', async () => {
    const { onPlay, onStay } = setup();
    const play = screen.getByRole('button', { name: 'Next episode, starts in 7 seconds' });
    expect((screen.getByTestId('countdown-fill') as HTMLElement).style.width).toBe('30%');
    await userEvent.click(screen.getByRole('button', { name: 'Watch credits' }));
    expect(onStay).toHaveBeenCalledOnce();
    await userEvent.click(play);
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('says Cancel when no credits are playing, and has no countdown without autoplay', () => {
    setup({ credits: false, countdown: null, next: { ...next, runtime: null, overview: null, title: null } });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next episode' })).toBeTruthy();
    expect(screen.queryByTestId('countdown-fill')).toBeNull();
    // Without a runtime the file's length is used; without a title, the episode number.
    expect(screen.getByRole('dialog').textContent).toContain('S01E09 · 52m');
    expect(screen.getByText('Episode 9')).toBeTruthy();
  });

  it('after the end: Cancel stops the countdown; with nothing counting down only Next episode is left', () => {
    setup({ ended: true, credits: false });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    cleanup();
    setup({ ended: true, credits: false, countdown: null });
    expect(screen.queryByRole('button', { name: /Cancel|Watch credits/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next episode' })).toBeTruthy();
  });
});
