/// <reference lib="dom" />
// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The Control Center page as vidalune.com serves it, with its own script. */
function openPanel() {
  const html = fs.readFileSync(path.resolve('web/ceo.html'), 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
  new Function(fs.readFileSync(path.resolve('web/ceo.js'), 'utf8'))();
}

/** What /api/ceo/dashboard answers, with the relays' traffic right now. */
const dashboard = (mbpsNow: number) => ({
  customers: { total: 3, active: 2, suspended: 0, new7: 1, new30: 2, growth30: null },
  access: { total: 2, byType: {}, expiringIn14Days: 0, expired: 0 },
  relays: { nodes: 1, online: 1, clients: 4, capacityMbps: 1000, mbpsNow, availableMbps: 1000 - mbpsNow, usage: mbpsNow / 10, nearQuota: [], list: [] },
  servers: { connected: 1, total: 1 },
  activity: [],
});

const text = () => document.getElementById('view')!.textContent ?? '';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Control Center shows live figures', () => {
  it('fetches the current bandwidth again by itself, without blanking the page', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    let mbps = 12.5;
    const fetchMock = vi.fn(async (url: string) => {
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url === '/api/account') return json({ ceo: true, email: 'ceo@example.com', version: '0.19.3' });
      if (url === '/api/ceo/dashboard') return json(dashboard(mbps));
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    location.hash = '#/overview';
    openPanel();
    await vi.waitFor(() => expect(text()).toContain('12.5 Mbit/s'));
    // Which version of vidalune.com runs, under the menu.
    expect(document.getElementById('account')!.textContent).toContain('Vidalune 0.19.3');

    mbps = 87.3;
    const skeletons: number[] = [];
    new MutationObserver(() => skeletons.push(document.querySelectorAll('#view .cc-skeleton').length)).observe(document.getElementById('view')!, { childList: true, subtree: true });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => expect(text()).toContain('87.3 Mbit/s'));
    // The figures were replaced in place: no loading skeleton in between.
    expect(skeletons.every((n) => n === 0)).toBe(true);

    // Not while a dialog is open (someone is filling it in).
    (document.getElementById('dialog') as HTMLDialogElement).setAttribute('open', '');
    mbps = 50;
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(text()).toContain('87.3 Mbit/s');
  });
});

describe('the Control Center community page', () => {
  it('shows the Discord link and saves a new one', async () => {
    let saved: unknown = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url === '/api/account') return json({ ceo: true, email: 'ceo@example.com', version: '0.19.18' });
      if (url === '/api/ceo/community' && init?.method === 'PUT') {
        saved = JSON.parse(String(init.body));
        return json(saved);
      }
      if (url === '/api/ceo/community') return json({ discordUrl: 'https://discord.gg/S9X7yDNqEP' });
      return json({});
    }));
    location.hash = '#/community';
    openPanel();
    const input = await vi.waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('#view input[name="discordUrl"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(input.value).toBe('https://discord.gg/S9X7yDNqEP');
    input.value = 'https://discord.gg/NewInvite';
    input.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(saved).toEqual({ discordUrl: 'https://discord.gg/NewInvite' }));
  });
});
