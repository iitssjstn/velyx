import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationsPage, NOTIFICATION_EVENTS, type NotificationItem } from './Notifications';

afterEach(() => vi.unstubAllGlobals());

const WEBHOOK = 'https://discord.com/api/webhooks/1234/abcdef';
const events = Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, e !== 'newMedia' && e !== 'newDevice']));

function setup(items: NotificationItem[], configured = false) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url === '/api/admin/notifications') return json({ items, unread: items.filter((i) => !i.read).length });
    if (url === '/api/admin/notifications/settings') return json({ events, discord: { configured: configured || !!body?.discordWebhook, hint: '…cdef' } });
    if (url === '/api/admin/notifications/test') return json({ ok: false, error: 'Discord refused the message.' });
    return json({ ok: true });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NotificationsPage />
    </QueryClientProvider>,
  );
  return calls;
}

describe('Notifications page', () => {
  it('shows notifications and marks them read', async () => {
    const calls = setup([
      { id: 2, event: 'cleanupPlanned', title: '1 file will be deleted', body: 'Alien, by rule "Seen by all".', createdAt: Date.now(), read: false },
      { id: 1, event: 'scanFailed', title: 'Scan failed', body: '', createdAt: Date.now() - 60_000, read: true },
    ]);
    expect(await screen.findByText('1 file will be deleted')).toBeTruthy();
    expect(screen.getByText('Scan failed')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/notifications/read')).toBe(true);
  });

  it('turns events on and off and saves a Discord webhook', async () => {
    const calls = setup([]);
    expect(await screen.findByText('No notifications.')).toBeTruthy();
    const newMedia = await screen.findByRole('checkbox', { name: /New files found by a scan/ });
    expect((newMedia as HTMLInputElement).checked).toBe(false);
    await userEvent.click(newMedia);
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ events: { newMedia: true } });
    await userEvent.type(screen.getByPlaceholderText(/discord\.com/), WEBHOOK);
    await userEvent.click(screen.getByRole('button', { name: 'Save webhook' }));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ discordWebhook: WEBHOOK });
  });

  it('tests a configured Discord channel', async () => {
    const calls = setup([], true);
    await userEvent.click(await screen.findByRole('button', { name: /Send a test/ }));
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/notifications/test')).toBe(true);
  });
});
