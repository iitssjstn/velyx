import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnRules, hasCondition, type OwnRule, type PlannedDeletion } from './CleanupOwnRules';

afterEach(() => vi.unstubAllGlobals());

const GB = 1024 ** 3;
const saved: OwnRule = { id: 'r1', name: 'Seen by all', enabled: true, libraryId: null, kind: 'all', watched: 'everyone', addedDays: 30, notPlayedDays: null, minGb: null, action: 'delete', graceDays: 7 };
const plan: PlannedDeletion = { fileId: 5, title: 'Alien', subtitle: '1979', library: 'Films', size: 4 * GB, rule: 'Seen by all', dueAt: Date.now() + 3 * 86_400_000 };

function setup(rules: OwnRule[], planned: PlannedDeletion[] = []) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url === '/api/admin/cleanup/rules') return json(method === 'PUT' ? body : { rules });
    if (url === '/api/admin/cleanup/planned') return json(planned);
    if (url === '/api/admin/cleanup/rules/preview') return json({ files: 2, bytes: 8 * GB, items: [{ fileId: 1, title: 'Alien', subtitle: null }, { fileId: 2, title: 'Dune', subtitle: null }] });
    return json({});
  }));
  const onKeep = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OwnRules libraries={[{ id: 1, name: 'Films' }]} deletionEnabled={false} onKeep={onKeep} />
    </QueryClientProvider>,
  );
  return { calls, onKeep };
}

describe('Own clean-up rules', () => {
  it('needs at least one condition', () => {
    expect(hasCondition({ watched: 'any', addedDays: null, notPlayedDays: null, minGb: null })).toBe(false);
    expect(hasCondition({ watched: 'any', addedDays: null, notPlayedDays: null, minGb: 10 })).toBe(true);
  });

  it('lists rules with a summary and the planned deletions, which can be kept', async () => {
    const { onKeep } = setup([saved], [plan]);
    expect(await screen.findByText('Seen by all')).toBeTruthy();
    expect(screen.getByText('watched by everyone · added 30+ days ago · deletes after 7 days')).toBeTruthy();
    expect(await screen.findByText('Planned deletions')).toBeTruthy();
    expect(screen.getByText(/Deleting is off: planned files wait/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onKeep).toHaveBeenCalledWith([5]);
  });

  it('adds a rule after checking what it catches', async () => {
    const { calls } = setup([]);
    expect(await screen.findByText('No own rules yet.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByPlaceholderText(/For example/), 'Old and seen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check what this rule catches' }));
    expect(await within(dialog).findByText('2 files now match (8.0 GB).')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Plan deleting after/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Save/ }));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({ rules: [{ name: 'Old and seen', watched: 'everyone', addedDays: 30, action: 'delete', graceDays: 7 }] });
  });

  it('removes a rule only after confirming', async () => {
    const { calls } = setup([saved]);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Remove the rule "Seen by all"\?/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ rules: [] });
  });
});
