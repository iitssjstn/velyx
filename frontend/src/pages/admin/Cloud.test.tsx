import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CloudPage, type CloudStatus } from './Cloud';

afterEach(() => vi.unstubAllGlobals());

const off: CloudStatus = { enabled: false, account: null, code: null, serviceUrl: 'https://vidalune.com' };
const waiting: CloudStatus = { enabled: true, account: null, code: { code: 'K7F3-Q9MA', expiresAt: Date.now() + 600_000, linkUrl: 'https://vidalune.com/link#K7F3-Q9MA' }, serviceUrl: 'https://vidalune.com' };
const linked: CloudStatus = { enabled: true, account: 'justin@example.com', code: null, serviceUrl: 'https://vidalune.com' };

function setup(initial: CloudStatus, answers: Record<string, CloudStatus>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const body = url === '/api/admin/cloud' ? initial : answers[url] ?? initial;
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
    expect(calls).toEqual(['GET /api/admin/cloud']);
    await userEvent.click(screen.getByRole('button', { name: 'Link to a Vidalune account' }));
    expect(await screen.findByText('K7F3-Q9MA')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the account page/ }).getAttribute('href')).toBe('https://vidalune.com/link#K7F3-Q9MA');
  });

  it('shows the linked account and unlinks after confirming', async () => {
    const calls = setup(linked, { '/api/admin/cloud/unlink': off });
    expect(await screen.findByText('Linked to justin@example.com.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink' }));
    expect(calls).toContain('POST /api/admin/cloud/unlink');
    expect(await screen.findByText('Not linked.')).toBeTruthy();
  });
});
