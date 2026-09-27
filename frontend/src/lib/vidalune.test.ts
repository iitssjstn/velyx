import { beforeEach, describe, expect, it } from 'vitest';
import { markSignedOut, onVidaluneApp, serversPage, shouldAutoOpen } from './vidalune';

beforeEach(() => window.sessionStorage.clear());

describe('app.vidalune.com', () => {
  it('knows when this page is shown there, and where to choose another server', () => {
    expect(onVidaluneApp('https://app.vidalune.com', 'https://app.vidalune.com')).toBe(true);
    expect(onVidaluneApp('https://app.vidalune.com', 'https://media.example.com')).toBe(false);
    expect(onVidaluneApp(null, 'https://app.vidalune.com')).toBe(false);
    expect(serversPage('https://app.vidalune.com')).toBe('https://app.vidalune.com/_vl/servers?choose');
  });

  it('signs back in by itself at most every half minute, and never after signing out', () => {
    expect(shouldAutoOpen(1_000_000)).toBe(true);
    expect(shouldAutoOpen(1_010_000)).toBe(false);
    expect(shouldAutoOpen(1_031_000)).toBe(true);
    markSignedOut();
    expect(shouldAutoOpen(2_000_000)).toBe(false);
  });
});
