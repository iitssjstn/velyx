import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('subtitle preference persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to the TV preset, but preserves existing custom styles', async () => {
    const prefs = await import('./prefs');
    expect(prefs.getPrefs().castSubtitleDefaults).toBe(true);
    prefs.setPrefs({ subtitleSize: 'large', subtitleColor: 'yellow' });
    vi.resetModules();
    expect((await import('./prefs')).getPrefs()).toMatchObject({ subtitleSize: 'large', subtitleColor: 'yellow', castSubtitleDefaults: false });
    localStorage.setItem('velyx.playback', JSON.stringify({ subtitleSize: 'small', subtitleEdge: 'none' }));
    vi.resetModules();
    expect((await import('./prefs')).getPrefs()).toMatchObject({ subtitleSize: 'small', subtitleEdge: 'none', castSubtitleDefaults: false });
  });

  it('normalises corrupt styles and retains edits if storage is unavailable', async () => {
    localStorage.setItem('velyx.playback', JSON.stringify({ subtitleSize: 'bad', subtitlePosition: 999 }));
    const prefs = await import('./prefs');
    expect(prefs.getPrefs()).toMatchObject({ subtitleSize: 'medium', subtitlePosition: 20 });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    prefs.setPrefs({ subtitleColor: 'yellow' });
    expect(prefs.getPrefs().subtitleColor).toBe('yellow');
  });

  it('loads account style ahead of device style and saves changes in order', async () => {
    const { api } = await import('./api');
    vi.spyOn(api, 'get').mockResolvedValue({ subtitleStyle: { size: 'large', color: 'yellow', background: 'solid', edge: 'outline', position: 10, castDefaults: false } });
    const put = vi.spyOn(api, 'put').mockResolvedValue({});
    const prefs = await import('./prefs');
    const stop = prefs.syncSubtitlePrefs();
    await vi.waitFor(() => expect(prefs.getPrefs().subtitleColor).toBe('yellow'));
    prefs.setPrefs({ subtitleColor: 'white' });
    await vi.waitFor(() => expect(put).toHaveBeenCalledWith('/api/account/preferences', { subtitleStyle: { size: 'large', color: 'white', background: 'solid', edge: 'outline', position: 10, castDefaults: false } }));
    stop();
  });

  it('does not overwrite newer edits with an old account response and keeps local fallback', async () => {
    const { api } = await import('./api');
    let resolve!: (value: unknown) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((r) => { resolve = r; }));
    vi.spyOn(api, 'put').mockRejectedValue(new Error('offline'));
    const prefs = await import('./prefs');
    const stop = prefs.syncSubtitlePrefs();
    prefs.setPrefs({ subtitleColor: 'yellow' });
    resolve({ subtitleStyle: { color: 'white', size: 'small' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(prefs.getPrefs().subtitleColor).toBe('yellow');
    expect(JSON.parse(localStorage.getItem('velyx.playback')!).subtitleColor).toBe('yellow');
    stop();
  });
});
