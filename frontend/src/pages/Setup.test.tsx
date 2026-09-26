import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SetupPage } from './Setup';

function renderSetup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SetupPage />
    </QueryClientProvider>,
  );
}

async function fillForm(password: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Username'), 'justin');
  await user.type(screen.getByLabelText('Password'), password);
  await user.type(screen.getByLabelText('Confirm password'), confirm);
  return user;
}

afterEach(() => vi.unstubAllGlobals());

describe('SetupPage', () => {
  it('refuses mismatching passwords without calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderSetup();
    const user = await fillForm('correct-horse', 'correct-horsE');
    await user.click(screen.getByRole('button', { name: 'Create Velyx' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The passwords do not match.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates the admin and sends the optional TMDB key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1, username: 'justin', role: 'admin' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderSetup();
    const user = await fillForm('correct-horse', 'correct-horse');
    await user.type(screen.getByLabelText(/TMDB API key/), ' abc123 ');
    await user.click(screen.getByRole('button', { name: 'Create Velyx' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/setup');
    expect(JSON.parse(String(init.body))).toEqual({ username: 'justin', password: 'correct-horse', serverName: 'Velyx', tmdbApiKey: 'abc123' });
  });

  it('shows the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'That username is not allowed.' }), { status: 400 })));
    renderSetup();
    const user = await fillForm('correct-horse', 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Create Velyx' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'That username is not allowed.');
  });
});
