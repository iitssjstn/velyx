import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { cardFacts, ContinueCard, PosterCard } from './Cards';
import { Artwork } from './Artwork';
import type { MovieCard, ShowCard } from '../lib/types';

const movie: MovieCard = {
  type: 'movie',
  id: 7,
  title: 'Interstellar',
  year: 2014,
  posterPath: '/p.jpg',
  backdropPath: null,
  rating: 8.4,
  runtime: 169,
  overview: null,
  genres: ['Adventure', 'Drama'],
  addedAt: 0,
  progress: { positionSec: 600, durationSec: 6000, completed: false },
  favorite: false,
};

describe('PosterCard', () => {
  it('links to the movie and shows progress', () => {
    render(
      <MemoryRouter>
        <PosterCard item={movie} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveProperty('pathname', '/movies/7');
    // Title under the poster, repeated in the hover details.
    expect(screen.getAllByText('Interstellar')).toHaveLength(2);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('10');
    expect(screen.getByRole('img', { name: 'Interstellar' }).getAttribute('src')).toBe('/api/images/w342/p.jpg');
  });

  it('marks fully watched shows', () => {
    const show: ShowCard = { type: 'show', id: 3, title: 'Breaking Bad', year: 2008, posterPath: null, backdropPath: null, rating: null, overview: null, genres: [], addedAt: 0, seasonCount: 1, episodeCount: 2, watchedCount: 2, favorite: false };
    render(
      <MemoryRouter>
        <PosterCard item={show} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveProperty('pathname', '/shows/3');
    expect(screen.getByTitle('Watched')).toBeTruthy();
  });
});

describe('PosterCard hover details', () => {
  it('shows year, runtime, rating and genres from the card data, hidden until hover or focus', () => {
    render(
      <MemoryRouter>
        <PosterCard item={movie} />
      </MemoryRouter>,
    );
    expect(screen.getByText('2014 • 2h 49m')).toBeTruthy();
    expect(screen.getByText('8.4')).toBeTruthy();
    expect(screen.getByText('Adventure • Drama')).toBeTruthy();
    // Decorative for screen readers (the link already names the title), invisible until hovered.
    const overlay = screen.getByText('2014 • 2h 49m').closest('[aria-hidden="true"]')!;
    expect(overlay.className).toMatch(/opacity-0/);
    expect(overlay.className).toMatch(/group-hover:opacity-100/);
    expect(overlay.className).toMatch(/group-focus-visible:opacity-100/);
    // The progress bar and its room stay visible above the details.
    expect(overlay.className).toMatch(/pb-5/);
    expect(screen.getByRole('progressbar').className).toMatch(/z-10/);
  });

  it('describes series by their number of seasons', () => {
    const base: ShowCard = { type: 'show', id: 1, title: 'Breaking Bad', year: 2008, posterPath: null, backdropPath: null, rating: 9.5, overview: null, genres: ['Crime', 'Drama'], addedAt: 0, seasonCount: 5, episodeCount: 62, watchedCount: 0, favorite: false };
    expect(cardFacts(base)).toBe('2008 • 5 Seasons');
    expect(cardFacts({ ...base, seasonCount: 1 })).toBe('2008 • 1 Season');
    expect(cardFacts({ ...base, seasonCount: 0, year: null })).toBe('');
    expect(cardFacts({ ...movie, runtime: null })).toBe('2014');
  });
});

describe('Artwork', () => {
  it('renders a typographic fallback without artwork', () => {
    render(<Artwork path={null} title="No Poster Film" />);
    expect(screen.getByRole('img', { name: 'No Poster Film' }).textContent).toBe('No Poster Film');
  });
});

describe('ContinueCard', () => {
  const episode = { type: 'episode' as const, id: 42, title: 'Reacher', subtitle: 'S2 E4', imagePath: null, posterPath: null, showId: 7, seasonNumber: 2, episodeNumber: 4, episodeTitle: 'A Night at the Motel', upNext: false, progress: { positionSec: 1934, durationSec: 2901 }, percent: 67, updatedAt: 0 };

  it('shows season, episode and position, opens details, and resumes from the saved position', () => {
    render(
      <MemoryRouter>
        <ContinueCard item={episode} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Season 2 · Episode 4 · A Night at the Motel')).toBeTruthy();
    expect(screen.getByText('32:14 / 48:21')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Reacher, Season 2 · Episode 4: details' }) as HTMLAnchorElement).getAttribute('href')).toBe('/shows/7');
    expect((screen.getByRole('link', { name: 'Resume Reacher, Season 2 · Episode 4' }) as HTMLAnchorElement).getAttribute('href')).toBe('/play/episode/42?t=1934');
  });

  it('offers Play for the next episode, and Start over / Mark as watched / Remove in its menu', async () => {
    const marked: number[] = [];
    const removed: number[] = [];
    const { rerender } = render(
      <MemoryRouter>
        <ContinueCard item={{ ...episode, upNext: true, progress: null, percent: 0, episodeNumber: 5 }} onMarkWatched={(i) => marked.push(i.id)} onDismiss={(i) => removed.push(i.id)} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^Up next · Season 2 · Episode 5/)).toBeTruthy();
    expect((screen.getByRole('link', { name: /^Play Reacher/ }) as HTMLAnchorElement).getAttribute('href')).toBe('/play/episode/42');
    await userEvent.click(screen.getByRole('button', { name: /^More actions for Reacher/ }));
    // Nothing to start over for an episode that was not started.
    expect(screen.queryByRole('menuitem', { name: 'Start over' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark as watched' }));
    expect(marked).toEqual([42]);
    expect(screen.queryByRole('menu')).toBeNull();

    rerender(
      <MemoryRouter>
        <ContinueCard item={episode} onMarkWatched={(i) => marked.push(i.id)} onDismiss={(i) => removed.push(i.id)} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^More actions for Reacher/ }));
    expect((screen.getByRole('menuitem', { name: 'Start over' }) as HTMLAnchorElement).getAttribute('href')).toBe('/play/episode/42?t=0');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^More actions for Reacher/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from Continue Watching' }));
    expect(removed).toEqual([42]);
  });

  it('shows a movie with its year and links to the movie page', () => {
    render(
      <MemoryRouter>
        <ContinueCard item={{ ...episode, type: 'movie', id: 3, title: 'Dune', subtitle: '2021', showId: null, seasonNumber: null, episodeNumber: null, episodeTitle: null, progress: { positionSec: 3600, durationSec: 9360 }, percent: 38 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('2021')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Dune, 2021: details' }) as HTMLAnchorElement).getAttribute('href')).toBe('/movies/3');
    expect(screen.getByText('1:00:00 / 2:36:00')).toBeTruthy();
  });
});

describe('cast row', () => {
  it('has scroll buttons, like the other rows', async () => {
    const { CastRow } = await import('./People');
    const cast = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, name: `Actor ${i + 1}`, profilePath: null, role: `Role ${i + 1}` }));
    render(<CastRow cast={cast} />);
    const scrollBy = vi.fn();
    const row = screen.getByText('Actor 1').closest('.overflow-x-auto') as HTMLElement;
    row.scrollBy = scrollBy;
    await userEvent.click(screen.getByRole('button', { name: 'Scroll Cast right' }));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(screen.getByRole('button', { name: 'Scroll Cast left' })).toBeTruthy();
  });
});
