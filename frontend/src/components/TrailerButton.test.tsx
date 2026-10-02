import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrailerButton } from './TrailerButton';

afterEach(() => vi.unstubAllGlobals());

function show(answer: unknown) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(answer), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TrailerButton type="movie" id={5} title="The Matrix" />
    </QueryClientProvider>,
  );
  return urls;
}

describe('TrailerButton', () => {
  it('plays the trailer without cookies, only once the viewer asks for it', async () => {
    const urls = show({ trailer: { key: 'vKQi3bBA1y8', name: 'Official Trailer' } });
    const button = await screen.findByRole('button', { name: 'Trailer' });
    expect(urls).toEqual(['/api/movies/5/trailer']);
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(button);
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/vKQi3bBA1y8?autoplay=1&rel=0&modestbranding=1');
    expect(screen.getByRole('dialog', { name: 'Trailer: The Matrix' })).toBeTruthy();
  });

  it('is not there when no trailer is known', async () => {
    const urls = show({ trailer: null });
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Trailer' })).toBeNull();
  });
});
