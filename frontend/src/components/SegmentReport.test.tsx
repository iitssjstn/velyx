import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { reportFound, reportProblems, SegmentReport } from './SegmentReport';
import { setLanguage } from '../i18n';

afterEach(async () => {
  vi.unstubAllGlobals();
  await setLanguage('en');
});

function setup(status = 200, found = { recap: false, intro: true, credits: false }) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: 'Too many reports' }), { status });
    }),
  );
  const onClose = vi.fn();
  render(<SegmentReport episodeId={12} position={95.6} found={found} open onClose={onClose} />);
  return { calls, onClose };
}

describe('reporting a wrong intro or credits', () => {
  it('sends the part, the problem and where the viewer is, and thanks them', async () => {
    const { calls } = setup();
    expect(screen.getByText(/at 1:35/)).toBeTruthy();
    // The intro was found: its times can be wrong.
    await userEvent.click(screen.getByRole('radio', { name: 'Ends too late' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(calls).toEqual([{ method: 'POST', url: '/api/episodes/12/segment-report', body: { kind: 'intro', problem: 'ends-late', position: 96 } }]);
    expect((await screen.findByRole('status')).textContent).toContain('Thanks, the administrator will take a look.');
  });

  it('offers only "not recognised" for a part that was not found', async () => {
    const { calls } = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Credits' }));
    expect(screen.queryByRole('radio', { name: 'Starts too early' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: 'Not recognised' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(calls[0]!.body).toEqual({ kind: 'credits', problem: 'missing', position: 96 });
  });

  it('says so kindly when too many reports were sent', async () => {
    setup(429);
    await userEvent.click(screen.getByRole('radio', { name: 'Starts too early' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toContain('You have sent a lot of reports. Try again later.');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('closes with Escape', async () => {
    const { onClose } = setup();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('is in Dutch for a Dutch interface', async () => {
    await setLanguage('nl');
    setup();
    expect(screen.getByRole('dialog', { name: 'Klopt de intro of aftiteling niet?' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Stopt te laat' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Er is geen intro in deze aflevering' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Versturen' })).toBeTruthy();
  });

  it('knows which parts were found for the file being played', () => {
    const segments = { fileId: 5, recap: null, intro: { start: 1, end: 2 }, credits: { start: 3, end: 4 }, postCredits: null, manual: false };
    expect(reportFound(segments, 5)).toEqual({ recap: false, intro: true, credits: true });
    expect(reportFound(segments, 6)).toEqual({ recap: false, intro: false, credits: false });
    expect(reportFound(null, 5)).toEqual({ recap: false, intro: false, credits: false });
    expect(reportProblems(false)).toEqual(['missing']);
  });
});
