import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CloudPage, type CloudStatus, type DirectPortStatus } from './Cloud';

afterEach(() => vi.unstubAllGlobals());

const noRelay = { enabled: false, url: null, connected: false, error: null, allowed: true };
const off: CloudStatus = { enabled: false, account: null, code: null, serviceUrl: 'https://vidalune.com', relay: noRelay, remoteAccess: false, homeNetworks: [] };
const waiting: CloudStatus = { enabled: true, account: null, code: { code: 'K7F3-Q9MA', expiresAt: Date.now() + 600_000, linkUrl: 'https://vidalune.com/link#K7F3-Q9MA' }, serviceUrl: 'https://vidalune.com', relay: noRelay, remoteAccess: false, homeNetworks: [] };
const linked: CloudStatus = { enabled: true, account: 'justin@example.com', code: null, serviceUrl: 'https://vidalune.com', relay: noRelay, remoteAccess: false, homeNetworks: [] };
const relayed: CloudStatus = { ...linked, relay: { enabled: true, url: 'https://k7f3q9ma.vidalune.com', connected: true, error: null, allowed: true } };

const directPort: DirectPortStatus = { publicPort: 32400, internalPort: 32400 };
let lastPortWrite: { publicPort: number } | null = null;

function setup(initial: CloudStatus, answers: Record<string, CloudStatus | DirectPortStatus>) {
  const calls: string[] = [];
  lastPortWrite = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/admin/direct-port' && init?.method === 'PUT') lastPortWrite = JSON.parse(String(init.body));
    const body = url === '/api/admin/direct-port' ? (answers[url] ?? directPort) : url === '/api/admin/cloud' ? initial : answers[url] ?? initial;
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CloudPage />
    </QueryClientProvider>,
  );
  return calls;
}

describe('Vidalune account page', () => {
  it('says what is shared and contacts nothing until linking is turned on', async () => {
    const calls = setup(off, { '/api/admin/cloud/link': waiting, '/api/admin/cloud/check': waiting });
    expect(await screen.findByText('Not linked.')).toBeTruthy();
    expect(screen.getByText(/Never media, users or what anyone watches/)).toBeTruthy();
    expect(calls.sort()).toEqual(['GET /api/admin/cloud', 'GET /api/admin/direct-port']);
    await userEvent.click(screen.getByRole('button', { name: 'Link to a Vidalune account' }));
    expect(await screen.findByText('K7F3-Q9MA')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the account page/ }).getAttribute('href')).toBe('https://vidalune.com/link#K7F3-Q9MA');
  });

  it('turns the control relay on and says media stays direct', async () => {
    const calls = setup(linked, { '/api/admin/cloud/relay': relayed });
    expect(await screen.findByText(/Only control API requests pass through vidalune.com/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Turn the relay on' }));
    expect(calls).toContain('POST /api/admin/cloud/relay');
    expect(await screen.findByText('Controls available on app.vidalune.com and in the Vidalune app.')).toBeTruthy();
    expect(screen.queryByText(/k7f3q9ma/)).toBeNull();
    expect(screen.getByText('Connected.')).toBeTruthy();
  });

  it('says the relay needs a subscription when the account has no remote access', async () => {
    const calls = setup({ ...linked, relay: { ...noRelay, allowed: false } }, {});
    expect(await screen.findByText(/Watching video away from home needs remote access: on the Vidalune account justin@example.com/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Turn the relay on' }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.sort()).toEqual(['GET /api/admin/cloud', 'GET /api/admin/direct-port']);
  });

  it('says whether playing away from home works, and saves home networks', async () => {
    const saved = { ...linked, remoteAccess: true, homeNetworks: ['100.64.0.0/10'] };
    const calls = setup({ ...linked }, { '/api/admin/cloud/home-networks': saved });
    expect(await screen.findByText(/playback needs remote access for the viewer or server owner and a directly reachable server address/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Other networks that count as home'), '100.64.0.0/10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(calls).toContain('PUT /api/admin/cloud/home-networks');
    expect(await screen.findByText(/Remote access is enabled for this server/)).toBeTruthy();
  });

  it('shows the linked account and unlinks after confirming', async () => {
    const calls = setup(linked, { '/api/admin/cloud/unlink': off });
    expect(await screen.findByText('Linked to justin@example.com.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink' }));
    expect(calls).toContain('POST /api/admin/cloud/unlink');
    expect(await screen.findByText('Not linked.')).toBeTruthy();
  });

  it('lets the admin save the public port and hides internal certificate status', async () => {
    const calls = setup(linked, {});
    expect(await screen.findByText('Direct connection')).toBeTruthy();
    const port = screen.getByLabelText('Public port');
    await userEvent.clear(port);
    await userEvent.type(port, '32401');
    const section = port.closest('section')!;
    await userEvent.click(within(section).getByRole('button', { name: 'Save' }));
    expect(calls).toContain('PUT /api/admin/direct-port');
    expect(lastPortWrite).toEqual({ publicPort: 32401 });
  });

  it('only describes manual router forwarding and has no UPnP controls', async () => {
    setup(off, {});
    expect(await screen.findByText('Direct connection')).toBeTruthy();
    expect(screen.getByText(/forward that TCP port to port 32400/i)).toBeTruthy();
    expect(screen.queryByText(/UPnP/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /open the port/i })).toBeNull();
  });
});
