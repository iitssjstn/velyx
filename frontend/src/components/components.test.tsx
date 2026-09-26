import { describe, expect, it } from 'vitest';
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
  it('opens the details page, with a separate button to resume', () => {
    render(
      <MemoryRouter>
        <ContinueCard item={{ type: 'episode', id: 42, title: 'Breaking Bad', subtitle: 'S2 E1', imagePath: null, posterPath: null, showId: 7, progress: { positionSec: 600, durationSec: 3000 }, updatedAt: 0 }} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((l) => (l as HTMLAnchorElement).pathname)).toEqual(['/shows/7', '/play/episode/42']);
    expect(screen.getByRole('link', { name: 'Resume Breaking Bad' })).toBeTruthy();
  });

  it('links movies to the movie page', () => {
    render(
      <MemoryRouter>
        <ContinueCard item={{ type: 'movie', id: 3, title: 'Interstellar', subtitle: '2014', imagePath: null, posterPath: null, showId: null, progress: { positionSec: 60, durationSec: 6000 }, updatedAt: 0 }} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('link').map((l) => (l as HTMLAnchorElement).pathname)).toEqual(['/movies/3', '/play/movie/3']);
  });
});
