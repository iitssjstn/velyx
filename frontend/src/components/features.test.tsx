import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WatchedMenu } from './WatchedMenu';
import { ContinueCard } from './Cards';
import { smartHref } from '../pages/Collections';
import type { ContinueItem } from '../lib/types';

describe('WatchedMenu', () => {
  it('offers both actions for a partly watched series', async () => {
    const onMark = vi.fn();
    render(<WatchedMenu watchedCount={3} total={10} onMark={onMark} />);
    await userEvent.click(screen.getByRole('button', { name: 'Watched status of this series' }));
    const watched = screen.getByRole('menuitem', { name: 'Mark series as watched' }) as HTMLButtonElement;
    const unwatched = screen.getByRole('menuitem', { name: 'Mark series as unwatched' }) as HTMLButtonElement;
    expect(watched.disabled).toBe(false);
    expect(unwatched.disabled).toBe(false);
    await userEvent.click(unwatched);
    expect(onMark).toHaveBeenCalledWith(false);
  });

  it('disables what would change nothing', async () => {
    render(<WatchedMenu watchedCount={0} total={10} onMark={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Watched status of this series' }));
    expect((screen.getByRole('menuitem', { name: 'Mark series as unwatched' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ContinueCard', () => {
  it('can be removed from Continue Watching', async () => {
    const item: ContinueItem = { type: 'episode', id: 12, title: 'Severance', subtitle: 'S2 E4 · Woe’s Hollow', imagePath: null, posterPath: null, showId: 3, progress: { positionSec: 600, durationSec: 3000 }, updatedAt: 1 } as ContinueItem;
    const onDismiss = vi.fn();
    render(
      <MemoryRouter>
        <ContinueCard item={item} onDismiss={onDismiss} />
      </MemoryRouter>,
    );
    // Resume goes straight to the saved position (no "resume or start over?" prompt).
    expect(screen.getByRole('link', { name: 'Resume Severance' }).getAttribute('href')).toBe('/play/episode/12?t=600');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Severance from Continue Watching' }));
    expect(onDismiss).toHaveBeenCalledWith(item);
  });
});

describe('smart collections', () => {
  it('open the browse page with their filters', () => {
    expect(smartHref({ kind: 'movies', query: { resolution: '4k', sort: 'rating' } })).toBe('/movies?resolution=4k&sort=rating');
    expect(smartHref({ kind: 'shows', query: {} })).toBe('/shows');
  });
});
