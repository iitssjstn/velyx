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
      if (url === '/api/account') return json({ ceo: true, email: 'ceo@example.com', version: '0.19.28' });
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

const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
/** Answers the Control Center's requests from `routes` (by path without query), and records every URL asked. */
function serve(routes: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(url);
    if (url === '/api/account') return json({ ceo: true, email: 'ceo@example.com', version: '0.19.69' });
    const body = routes[url.split('?')[0]];
    return body === undefined ? new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }) : json(body);
  }));
  return asked;
}

describe('the Control Center overview', () => {
  it('lists what needs attention, each with a link to fix it', async () => {
    const d = dashboard(10);
    d.relays.list = [{ id: 2, name: 'Relay EU', status: 'offline' }] as never;
    (d.access as Record<string, unknown>).expiringIn7Days = 2;
    serve({ '/api/ceo/dashboard': d, '/api/ceo/mail': { configured: false }, '/api/ceo/tmdb': { configured: true }, '/api/ceo/subtitles': { configured: true } });
    location.hash = '#/overview';
    openPanel();
    await vi.waitFor(() => expect(text()).toContain('Needs attention (3)'));
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('#view .cc-attention a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#/relays/2', '#/mail', '#/access?show=expiring']);
    expect(text()).toContain('Relay EU is offline');
    expect(text()).not.toContain('TMDB is not set up');
  });

  it('says all is fine when nothing needs a look, also when a service cannot be read', async () => {
    serve({ '/api/ceo/dashboard': dashboard(10), '/api/ceo/mail': { configured: true } });
    location.hash = '#/overview';
    openPanel();
    await vi.waitFor(() => expect(text()).toContain('All good: nothing needs your attention right now.'));
    expect(document.querySelector('#view .cc-attention.fine')).not.toBeNull();
  });
});

describe('the Control Center customer list', () => {
  const customer = (id: number, email: string, extra: Record<string, unknown> = {}) => ({
    id, email, name: null, status: 'active', invited: false, verified: true, createdAt: 0, lastActive: null, access: null, relay: { name: 'Main' }, ...extra,
  });
  const list = {
    customers: [customer(1, 'ok@example.com'), customer(2, 'new@example.com', { verified: false })],
    total: 2, page: 1, pageSize: 50,
    summary: { total: 2, active: 2, new7: 1, expiring30: 0, unverified: 1 },
  };

  it('shows the key figures, who has not confirmed their address, and filters through the server', async () => {
    const asked = serve({ '/api/ceo/customers': list });
    location.hash = '#/customers';
    openPanel();
    await vi.waitFor(() => expect(text()).toContain('new@example.com'));
    const cards = Array.from(document.querySelectorAll('#view .cc-stat')).map((c) => c.textContent);
    expect(cards[0]).toContain('2');
    expect(cards[0]).toContain('1 not confirmed');
    const rows = Array.from(document.querySelectorAll('#view tbody tr'));
    expect(rows[0].textContent).toContain('Active');
    expect(rows[1].textContent).toContain('Not confirmed');

    const status = document.querySelector<HTMLSelectElement>('#view .cc-filter select')!;
    status.value = 'unverified';
    status.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(asked.some((u) => u.startsWith('/api/ceo/customers?') && new URL(u, 'http://x').searchParams.get('status') === 'unverified')).toBe(true));
  });

  it('opens the actions of a row without opening the customer', async () => {
    serve({ '/api/ceo/customers': list });
    location.hash = '#/customers';
    openPanel();
    const button = await vi.waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('#view tbody tr .cc-rowmenu-button');
      expect(b).not.toBeNull();
      return b!;
    });
    button.click();
    const items = Array.from(document.querySelectorAll('.cc-rowmenu-list:not([hidden]) button')).map((b) => b.textContent);
    expect(items).toEqual(['Open customer', 'Grant access', 'Suspend customer']);
    expect(location.hash).toBe('#/customers');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.cc-rowmenu-list:not([hidden])')).toBeNull();
  });
});

describe('the Control Center access page', () => {
  it('splits access by type, says payments are manual, and searches without asking the server again', async () => {
    const grant = (id: number, email: string, type: string) => ({ id, accountId: id, email, name: null, type, plan: 'remote', status: 'active', startsAt: 0, endsAt: null });
    const asked = serve({
      '/api/ceo/access': {
        grants: [grant(1, 'anna@example.com', 'customer'), grant(2, 'bob@example.com', 'beta')],
        summary: { total: 2, byType: { customer: 1, beta: 1 }, expiringIn7Days: 0, expiringIn30Days: 0, expired: 0 },
      },
    });
    location.hash = '#/access';
    openPanel();
    await vi.waitFor(() => expect(text()).toContain('anna@example.com'));
    expect(text()).toContain('Payments are not connected yet.');
    expect(document.querySelectorAll('#view .cc-donut circle, #view .cc-donut path').length).toBeGreaterThan(0);
    const legend = document.querySelector('#view .cc-breakdown-mini')!.textContent;
    expect(legend).toContain('Customer');
    expect(legend).toContain('Beta');

    const calls = asked.length;
    const search = document.querySelector<HTMLInputElement>('#view input[type="search"]')!;
    search.value = 'bob';
    search.dispatchEvent(new Event('input'));
    expect(text()).toContain('bob@example.com');
    expect(text()).not.toContain('anna@example.com');
    expect(asked.length).toBe(calls);
  });
});

describe('intros and credits in the Control Center', () => {
  it('lists seasons, shows what servers found and proposals, takes a proposal over and saves a correction', async () => {
    const sent: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') sent.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/account') return json({ ceo: true, email: 'ceo@example.com', version: '0.20.3' });
      if (url.startsWith('/api/ceo/detection?')) return json({ total: 1, page: 1, pageSize: 25, items: [{ tmdbShow: 1399, season: 2, title: 'Game of Thrones', servers: 3, episodes: 10, overrides: 1, proposals: 2, updatedAt: Date.now() }] });
      if (url === '/api/ceo/detection/1399/2') return json({ tmdbShow: 1399, season: 2, title: 'Game of Thrones', servers: 3, entries: [
        { episode: 1, kind: 'intro', duration: 3000, consensus: { start: 62, end: 92.5, confirmations: 2, reports: 3, manual: false }, proposals: [{ server: 'ab12cd', start: 60, end: 95 }], override: null },
        { episode: 1, kind: 'credits', duration: 3000, consensus: null, proposals: [], override: { start: 2900, end: 3000, updatedAt: 1 } },
      ] });
      return json({ ok: true });
    }));
    location.hash = '#/intros';
    openPanel();
    await vi.waitFor(() => expect(text()).toContain('Game of Thrones'));
    expect(text()).toContain('2 open');
    expect(document.querySelector('#nav a[href="#/intros"]')?.textContent).toBe('Intros & credits');

    location.hash = '#/intros/1399-2';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await vi.waitFor(() => expect(text()).toContain('Episode 1'));
    expect(text()).toContain('1:02 – 1:32.5 · 2 of 3 servers');
    expect(text()).toContain('Proposal ab12cd');
    // The CEO's correction of the credits is filled in, with a way to remove it.
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>('#view .cc-det-edit'));
    expect(forms).toHaveLength(3); // recap, intro, credits
    const [, introForm, creditsForm] = forms;
    expect(creditsForm.querySelector<HTMLInputElement>('input[name="start"]')!.value).toBe('48:20');
    // Taking the proposal over fills the intro's fields; saving sends seconds for this cut.
    Array.from(document.querySelectorAll<HTMLButtonElement>('#view button')).find((b) => b.textContent === 'Use')!.click();
    expect(introForm.querySelector<HTMLInputElement>('input[name="start"]')!.value).toBe('1:00');
    introForm.querySelector<HTMLInputElement>('input[name="end"]')!.value = '96.5';
    introForm.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(sent[0]).toEqual({ method: 'PUT', url: '/api/ceo/detection/1399/2/1', body: { kind: 'intro', duration: 3000, start: 60, end: 96.5 } }));
    // A time that is not one is not sent.
    introForm.querySelector<HTMLInputElement>('input[name="end"]')!.value = 'soon';
    introForm.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(introForm.textContent).toContain('Fill in start and end'));
    expect(sent).toHaveLength(1);
    Array.from(creditsForm.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Remove')!.click();
    await vi.waitFor(() => expect(sent[1]).toEqual({ method: 'DELETE', url: '/api/ceo/detection/1399/2/1?kind=credits&duration=3000', body: null }));
  });
});
