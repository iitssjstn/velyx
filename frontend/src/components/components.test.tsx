import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PosterCard } from './Cards';
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
    expect(screen.getByText('Interstellar')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('10');
    expect(screen.getByRole('img', { name: 'Interstellar' }).getAttribute('src')).toBe('/api/images/w342/p.jpg');
  });

  it('marks fully watched shows', () => {
    const show: ShowCard = { type: 'show', id: 3, title: 'Breaking Bad', year: 2008, posterPath: null, backdropPath: null, rating: null, overview: null, addedAt: 0, episodeCount: 2, watchedCount: 2, favorite: false };
    render(
      <MemoryRouter>
        <PosterCard item={show} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveProperty('pathname', '/shows/3');
    expect(screen.getByTitle('Watched')).toBeTruthy();
  });
});

describe('Artwork', () => {
  it('renders a typographic fallback without artwork', () => {
    render(<Artwork path={null} title="No Poster Film" />);
    expect(screen.getByRole('img', { name: 'No Poster Film' }).textContent).toBe('No Poster Film');
  });
});
