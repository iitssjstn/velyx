import { describe, expect, it, vi } from 'vitest';
import { backButton, createDialogs, DEFAULT_OK, mainButton } from './dialog';

describe('the app’s own message boxes', () => {
  it('shows one at a time; the next waits until the first is closed', () => {
    const d = createDialogs();
    const seen: Array<string | null> = [];
    d.subscribe((r) => seen.push(r?.title ?? null));
    d.alert('First', 'One');
    d.alert('Second');
    expect(d.shown()?.title).toBe('First');
    expect(seen).toEqual(['First']);
    d.close(d.shown()!.id);
    expect(seen).toEqual(['First', 'Second']);
    d.close(d.shown()!.id);
    expect(d.shown()).toBeNull();
    expect(seen).toEqual(['First', 'Second', null]);
  });

  it('gives a box without buttons an OK, and runs the pressed button once it is closed', () => {
    const d = createDialogs();
    d.alert('Vidalune', 'Requested.');
    expect(d.shown()?.buttons).toEqual([{ text: DEFAULT_OK }]);
    const onPress = vi.fn(() => expect(d.shown()).toBeNull());
    d.close(d.shown()!.id);
    d.alert('Sure?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Yes', onPress }]);
    const req = d.shown()!;
    d.close(req.id, req.buttons[1]);
    expect(onPress).toHaveBeenCalledOnce();
    // Closing twice (a double tap) does nothing more.
    d.close(req.id, req.buttons[1]);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('lets an action ask a new question right away', () => {
    const d = createDialogs();
    d.alert('Sign out?', undefined, [{ text: 'Sign out', onPress: () => d.alert('Signed out.') }]);
    const req = d.shown()!;
    d.close(req.id, req.buttons[0]);
    expect(d.shown()?.title).toBe('Signed out.');
  });

  it('knows which button Back presses and which one is the main one', () => {
    const cancel = { text: 'Cancel', style: 'cancel' as const };
    const remove = { text: 'Remove', style: 'destructive' as const };
    const req = (buttons: Parameters<typeof backButton>[0]['buttons']) => ({ id: 1, title: 't', buttons });
    expect(backButton(req([cancel, remove]))).toBe(cancel);
    expect(mainButton(req([cancel, remove]))).toBe(remove);
    expect(backButton(req([{ text: 'OK' }]))?.text).toBe('OK');
    expect(backButton(req([{ text: 'A' }, { text: 'B' }]))).toBeNull();
    expect(mainButton(req([cancel]))).toBeNull();
  });
});
