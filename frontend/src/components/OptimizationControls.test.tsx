import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OptimizationControls } from './OptimizationControls';

afterEach(() => vi.unstubAllGlobals());

function setup(answer: (url: string, method: string, body?: string) => unknown) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body });
    return new Response(JSON.stringify(answer(url, method, body)), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OptimizationControls fileId={7} /></QueryClientProvider>);
  return calls;
}

describe('OptimizationControls', () => {
  it('queues the selected compatible profile', async () => {
    const queued = { id: 3, profile: 'compat-1080p', status: 'queued', progress: 0, outputSize: null, error: null, updatedAt: 1 };
    let created = false;
    const calls = setup((url, method) => {
      if (url === '/api/admin/media/7/optimizations' && method === 'GET') return { variants: created ? [queued] : [] };
      if (url === '/api/admin/media/7/optimizations' && method === 'POST') { created = true; return { variant: queued }; }
      return {};
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Copy profile'), 'compat-1080p');
    await user.click(screen.getByRole('button', { name: 'Optimize' }));
    expect(calls.some((call) => call.url === '/api/admin/media/7/optimizations' && call.method === 'POST' && call.body === '{"profile":"compat-1080p"}')).toBe(true);
    expect((await screen.findAllByText('Queued')).length).toBeGreaterThan(0);
  });

  it('stops a running copy and offers to resume it', async () => {
    let status = 'processing';
    const calls = setup((url, method) => {
      if (url === '/api/admin/media/7/optimizations' && method === 'GET') return { variants: [{ id: 3, profile: 'compat-720p', status, progress: 50, outputSize: null, error: null, updatedAt: 1 }] };
      if (url === '/api/admin/optimizations/3/stop') { status = 'paused'; return { ok: true }; }
      if (url === '/api/admin/media/7/optimizations' && method === 'POST') return { variant: { id: 3, profile: 'compat-720p', status: 'queued', progress: 50 } };
      return {};
    });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Stop' });
    expect(screen.getByRole('button', { name: 'Remove copy' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(calls.some((call) => call.url === '/api/admin/optimizations/3/stop' && call.method === 'POST')).toBe(true);
    expect(calls.some((call) => call.url === '/api/admin/media/7/optimizations' && call.method === 'POST')).toBe(true);
  });

  it('removes only a generated copy after confirmation', async () => {
    const calls = setup((url, method) => {
      if (url === '/api/admin/media/7/optimizations' && method === 'GET') return { variants: [{ id: 3, profile: 'compat-720p', status: 'ready', progress: 100, outputSize: 1000, error: null, updatedAt: 1 }] };
      return {};
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove copy' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/only the generated copy/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove copy' }));
    expect(calls.some((call) => call.url === '/api/admin/optimizations/3' && call.method === 'DELETE')).toBe(true);
  });
});