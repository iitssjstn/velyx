import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { storedSubtitleStyle, storeSubtitleStyle } from './remember';
import { DEFAULT_SUBTITLE_STYLE } from './subtitleStyle';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

describe('stored subtitle styles', () => {
  beforeEach(() => vi.resetAllMocks());

  it('uses TV defaults on a new device', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    expect(await storedSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE);
  });

  it('migrates prior device choices without overriding them', async () => {
    const legacy = { size: 'large', color: 'yellow', background: 'solid', edge: 'none', position: 10 };
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(legacy));
    expect(await storedSubtitleStyle()).toEqual({ ...legacy, castDefaults: false });
  });

  it.each([true, false])('persists and restores castDefaults=%s', async (castDefaults) => {
    const style = { ...DEFAULT_SUBTITLE_STYLE, castDefaults, color: 'yellow' as const };
    await storeSubtitleStyle(style);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('velyx.subtitleStyle', JSON.stringify(style));
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(style));
    expect(await storedSubtitleStyle()).toEqual(style);
  });

  it('recovers from invalid JSON and storage errors', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue('{');
    expect(await storedSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE);
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('Unavailable'));
    expect(await storedSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE);
    vi.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('Full'));
    await expect(storeSubtitleStyle(DEFAULT_SUBTITLE_STYLE)).resolves.toBeUndefined();
  });
});
