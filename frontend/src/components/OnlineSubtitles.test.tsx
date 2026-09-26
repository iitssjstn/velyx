import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnlineSubtitles } from './OnlineSubtitles';
import { setLanguage } from '../i18n';
import type { OnlineSubtitleResult, SubtitleOption } from '../lib/types';

const result = (fileId: number, x: Partial<OnlineSubtitleResult> = {}): OnlineSubtitleResult => ({ fileId, language: 'nl', release: `Heat.1995.Release.${fileId}`, hearingImpaired: false, forced: false, downloads: 1200, hashMatch: false, machineTranslated: false, trusted: false, fetched: null, ...x });
const option = (id: number): SubtitleOption => ({ key: `onl-${id}`, kind: 'online', label: 'x', language: 'nl', forced: false, isDefault: false, url: `/api/online-subtitles/${id}.vtt`, removable: true });

function mount(onChosen = vi.fn(), activeKey: string | null = null) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OnlineSubtitles fileId={7} defaultLanguage="nl" activeKey={activeKey} onChosen={onChosen} />
    </QueryClientProvider>,
  );
  return onChosen;
}

function stub(handler: (url: string, init?: RequestInit) => [number, unknown]) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const [status, body] = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.clear();
  await setLanguage('en');
});

describe('OnlineSubtitles', () => {
  it('searches right away in the preferred language and lists what it finds, best match marked', async () => {
    const calls = stub(() => [200, { language: 'nl', results: [result(1, { hashMatch: true, hearingImpaired: true }), result(2, { machineTranslated: true, downloads: 1 })] }]);
    mount();
    expect(await screen.findByText('Heat.1995.Release.1')).toBeTruthy();
    expect(calls[0]!.url).toBe('/api/media/7/subtitles/online?language=nl');
    expect(screen.getByText('Made for this file · SDH · 1,200 downloads')).toBeTruthy();
    expect(screen.getByText('Machine translation · 1 download')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement).value).toBe('nl');
  });

  it('fetches the one picked and hands it to the player', async () => {
    const calls = stub((url, init) => (init?.method === 'POST' ? [200, option(5)] : [200, { language: 'nl', results: [result(1)] }]));
    const onChosen = mount();
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Release\.1/ }));
    await waitFor(() => expect(onChosen).toHaveBeenCalledWith(option(5)));
    expect(calls.find((c) => c.method === 'POST')).toEqual({ url: '/api/media/7/subtitles/online', method: 'POST', body: { fileId: 1 } });
  });

  it('uses a subtitle fetched before without downloading it again', async () => {
    const calls = stub(() => [200, { language: 'nl', results: [result(1, { fetched: option(9) })] }]);
    const onChosen = mount(vi.fn(), 'onl-9');
    const item = await screen.findByRole('menuitemradio', { name: /Release\.1/ });
    expect(item.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(item);
    expect(onChosen).toHaveBeenCalledWith(option(9));
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('searches again in another language and remembers it', async () => {
    const calls = stub(() => [200, { language: 'en', results: [] }]);
    mount();
    await screen.findByText('No subtitles found in this language.');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'de');
    await waitFor(() => expect(calls.at(-1)!.url).toBe('/api/media/7/subtitles/online?language=de'));
    expect(localStorage.getItem('velyx.onlineSubtitleLanguage')).toBe('de');
  });

  it('shows why searching failed', async () => {
    stub(() => [429, { error: 'The daily download limit at OpenSubtitles has been reached. Try again tomorrow.' }]);
    mount();
    expect((await screen.findByRole('alert')).textContent).toBe('The daily download limit at OpenSubtitles has been reached. Try again tomorrow.');
  });

  it('speaks Dutch', async () => {
    await setLanguage('nl');
    stub(() => [200, { language: 'nl', results: [result(1, { hashMatch: true })] }]);
    mount();
    expect(await screen.findByText('Gemaakt voor dit bestand · 1.200 downloads')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Online zoeken' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Taal' })).toBeTruthy();
  });
});
