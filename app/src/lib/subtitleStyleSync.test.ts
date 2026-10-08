import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SUBTITLE_STYLE } from './subtitleStyle';
import { createSubtitleStyleSync, subtitlePreferencesReady } from './subtitleStyleSync';

const local = { ...DEFAULT_SUBTITLE_STYLE, color: 'yellow' as const, castDefaults: false };
const account = { ...DEFAULT_SUBTITLE_STYLE, size: 'large' as const };
const setup = () => {
  const options = {
    readDevice: vi.fn().mockResolvedValue(local),
    writeDevice: vi.fn().mockResolvedValue(undefined),
    writeAccount: vi.fn().mockResolvedValue(undefined),
    change: vi.fn(),
    saved: vi.fn(),
    failed: vi.fn(),
    active: () => true,
  };
  return { options, sync: createSubtitleStyleSync(options) };
};

describe('account subtitle style sync', () => {
  it('does not mount playback before delayed account preferences resolve', async () => {
    const { options, sync } = setup();
    expect(subtitlePreferencesReady({ isLoading: true, isFetching: true, isFetchedAfterMount: false })).toBe(false);
    // A previous playback's cached preferences must also wait for the new account response.
    expect(subtitlePreferencesReady({ isLoading: false, isFetching: true, isFetchedAfterMount: false })).toBe(false);
    expect(options.change).not.toHaveBeenCalled();
    expect(subtitlePreferencesReady({ isLoading: false, isFetching: false, isFetchedAfterMount: true })).toBe(true);
    await sync.load(account);
    expect(options.change).toHaveBeenCalledWith(account);
  });

  it('permits device fallback on account failure and does not unmount during later refetches', () => {
    expect(subtitlePreferencesReady({ isLoading: false, isFetching: false, isFetchedAfterMount: true })).toBe(true);
    expect(subtitlePreferencesReady({ isLoading: false, isFetching: true, isFetchedAfterMount: true })).toBe(true);
  });

  it('gives account choices priority and keeps them on this device', async () => {
    const { options, sync } = setup();
    await sync.load(account);
    expect(options.change).toHaveBeenCalledWith(account);
    expect(options.writeDevice).toHaveBeenCalledWith(account);
    expect(options.writeAccount).not.toHaveBeenCalled();
  });

  it.each([null, undefined])('keeps device choices when the account style is %s', async (raw) => {
    const { options, sync } = setup();
    await sync.load(raw);
    expect(options.change).toHaveBeenCalledWith(local);
    expect(options.writeDevice).not.toHaveBeenCalled();
  });

  it('falls back to device choices if the account read fails', async () => {
    const { options, sync } = setup();
    await sync.load(Promise.reject(new Error('Offline')));
    expect(options.change).toHaveBeenCalledWith(local);
  });

  it('validates and migrates legacy account choices', async () => {
    const { options, sync } = setup();
    await sync.load({ size: 'large', color: 'invalid', background: 'solid', edge: 'none', position: 99 });
    expect(options.change).toHaveBeenCalledWith({ size: 'large', color: 'white', background: 'solid', edge: 'none', position: 20, castDefaults: false });
  });

  it('does not overwrite edits with a delayed account read', async () => {
    const { options, sync } = setup();
    let resolve!: (value: unknown) => void;
    const loading = sync.load(new Promise((yes) => { resolve = yes; }));
    await sync.save(local);
    resolve(account);
    await loading;
    expect(options.change.mock.calls).toEqual([[local]]);
    expect(options.writeDevice.mock.calls).toEqual([[local]]);
  });

  it('does not overwrite edits with a delayed device read', async () => {
    const { options, sync } = setup();
    let resolve!: (value: unknown) => void;
    options.readDevice.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    const loading = sync.load(account);
    await sync.save(local);
    resolve(DEFAULT_SUBTITLE_STYLE);
    await loading;
    expect(options.change.mock.calls).toEqual([[local]]);
    expect(options.writeDevice.mock.calls).toEqual([[local]]);
  });

  it('keeps the latest edit on the device and in playback when saving the account fails', async () => {
    const { options, sync } = setup();
    const error = new Error('Offline');
    options.writeAccount.mockRejectedValue(error);
    await sync.save(local);
    expect(options.writeDevice).toHaveBeenCalledWith(local);
    expect(options.change.mock.calls).toEqual([[local]]);
    expect(options.failed).toHaveBeenCalledWith(error);
    expect(options.saved).not.toHaveBeenCalled();
  });

  it('serializes account writes while persisting later device choices immediately', async () => {
    const { options, sync } = setup();
    let finish!: () => void;
    options.writeAccount.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = sync.save(local);
    await vi.waitFor(() => expect(options.writeAccount).toHaveBeenCalledTimes(1));
    const second = sync.save(account);
    await vi.waitFor(() => expect(options.writeDevice).toHaveBeenLastCalledWith(account));
    expect(options.writeAccount).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    expect(options.writeAccount.mock.calls).toEqual([[local], [account]]);
    expect(options.saved.mock.calls).toEqual([[account]]);
  });

  it('does not notify an unmounted player after loading', async () => {
    const { options } = setup();
    options.active = () => false;
    await createSubtitleStyleSync(options).load(account);
    expect(options.change).not.toHaveBeenCalled();
  });
});
