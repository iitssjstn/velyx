import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'admin', role: 'admin' }, refetchServer: () => undefined }),
}));

import { PlaybackPage } from './Playback';

afterEach(() => vi.unstubAllGlobals());

describe('Admin → Playback', () => {
  it('has no settings for subtitles from online: they come through vidalune.com', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <PlaybackPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/Subtitles online/)).toBeNull();
    const urls = (fetchMock.mock.calls as unknown as [string][]).map(([url]) => url);
    expect(urls).not.toContain('/api/admin/online-subtitles');
  });
});
