import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrSettingsPage } from './ArrSettings';

afterEach(() => vi.unstubAllGlobals());

const off = { sonarr: { url: '', hasKey: false }, radarr: { url: '', hasKey: false } };

function setup(answer: (url: string, method: string, body?: string) => unknown) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body });
    return new Response(JSON.stringify(answer(url, method, body)), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ArrSettingsPage /></QueryClientProvider>);
  return calls;
}

describe('Sonarr and Radarr admin integration', () => {
  it('tests and saves Sonarr without exposing its key, then lists titles and links to the service', async () => {
    const calls = setup((url, method) => {
      if (url === '/api/admin/arr') return off;
      if (url === '/api/admin/arr/sonarr' && method === 'PUT') return { url: 'http://nas:8989/sonarr', hasKey: true, version: '4.0.0' };
      if (url === '/api/admin/arr/sonarr/items') return { items: [{ id: 4, title: 'The Expanse', year: 2015, monitored: true, status: 'continuing' }] };
      return {};
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Sonarr Address'), 'http://nas:8989/sonarr');
    await user.type(screen.getByLabelText('Sonarr API key'), 'secret-sonarr-key');
    await user.click(screen.getAllByRole('button', { name: 'Test and save' })[0]);
    expect(await screen.findByText('Connected (version 4.0.0).')).toBeTruthy();
    expect(await screen.findByText('The Expanse')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open service' }).getAttribute('href')).toBe('http://nas:8989/sonarr');
    expect(calls.find((call) => call.url === '/api/admin/arr/sonarr' && call.method === 'PUT')?.body).toContain('secret-sonarr-key');
    expect(document.body.textContent).not.toContain('secret-sonarr-key');
  });

  it('keeps Radarr files unless the administrator explicitly checks the delete-files option', async () => {
    const radarr = { ...off, radarr: { url: 'http://nas:7878', hasKey: true } };
    const calls = setup((url) => {
      if (url === '/api/admin/arr') return radarr;
      if (url === '/api/admin/arr/radarr/items') return { items: [{ id: 8, title: 'Arrival', year: 2016, monitored: false, status: 'released' }] };
      return {};
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Its media files will be kept/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(calls.some((call) => call.url === '/api/admin/arr/radarr/items/8?deleteFiles=false' && call.method === 'DELETE')).toBe(true);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(within(screen.getByRole('dialog')).getByLabelText('Also delete the media files from disk'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(calls.some((call) => call.url === '/api/admin/arr/radarr/items/8?deleteFiles=true' && call.method === 'DELETE')).toBe(true);
  });
});