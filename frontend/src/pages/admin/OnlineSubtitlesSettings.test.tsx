import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OnlineSubtitlesSettings } from './ServerSettings';

afterEach(() => vi.unstubAllGlobals());

function setup(status: object) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(status), { status: 200 })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <OnlineSubtitlesSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Subtitles online (through vidalune.com)', () => {
  it('is off until the server is linked, and says where to link it', async () => {
    setup({ via: null });
    expect(await screen.findByText('Off: link this server to a Vidalune account first')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Link this server' }).getAttribute('href')).toBe('/admin/cloud');
  });

  it('is on through vidalune.com once linked, with no key or account to fill in', async () => {
    setup({ via: 'vidalune' });
    expect(await screen.findByText('On, through vidalune.com')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Link this server' })).toBeNull();
  });
});
