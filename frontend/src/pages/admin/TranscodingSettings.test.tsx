import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TranscodingSettings } from './TranscodingSettings';

afterEach(() => vi.unstubAllGlobals());

describe('video conversion settings', () => {
  it('shows which encoders work and turns conversion on without a limit', async () => {
    const sent: unknown[] = [];
    const state = { settings: { enabled: false, encoder: 'auto', maxStreams: null }, support: { software: true, vaapi: '/dev/dri/renderD128', nvenc: false, checkedAt: 1 }, inUse: null, active: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          sent.push(body);
          return new Response(JSON.stringify({ ...state, settings: body, inUse: 'vaapi' }), { status: 200 });
        }
        return new Response(JSON.stringify(state), { status: 200 });
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TranscodingSettings />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Off: video a device cannot play is explained, not converted.')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Intel/AMD graphics (VAAPI) — works' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'NVIDIA graphics (NVENC) — not found' })).toBeTruthy();
    await userEvent.click(screen.getByLabelText(/Convert video that does not play otherwise/));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(sent).toEqual([{ enabled: true, encoder: 'auto', maxStreams: null }]);
    expect(await screen.findByText('On, with Intel/AMD graphics (VAAPI)')).toBeTruthy();
  });

  it('says when a graphics encoder runs but cannot cut the stream into pieces', async () => {
    const state = { settings: { enabled: true, encoder: 'auto', maxStreams: null }, support: { software: true, vaapi: null, nvenc: false, noKeyframes: ['vaapi'], checkedAt: 1 }, inUse: 'software', active: 0 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TranscodingSettings />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('option', { name: 'Intel/AMD graphics (VAAPI) — runs, but cannot cut the stream into pieces' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'NVIDIA graphics (NVENC) — not found' })).toBeTruthy();
  });
});
