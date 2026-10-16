import { describe, expect, it, vi } from 'vitest';
import { castStartAt, castStatus, castStatusOf, setCastStatus, subscribeCastStatus } from './castStatus';

describe('castStatus', () => {
  it('maps the Cast SDK state', () => {
    expect(castStatusOf('connecting')).toBe('connecting');
    expect(castStatusOf('connected')).toBe('connected');
    expect(castStatusOf('notConnected')).toBe('none');
    expect(castStatusOf('noDevicesAvailable')).toBe('none');
    expect(castStatusOf(null)).toBe('none');
  });

  it('is known at once and tells who listens when it changes', () => {
    const listener = vi.fn();
    const stop = subscribeCastStatus(listener);
    setCastStatus('connecting');
    setCastStatus('connecting');
    setCastStatus('connected');
    expect(castStatus()).toBe('connected');
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setCastStatus('none');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('castStartAt', () => {
  it('starts the TV at the resume point when nothing played on the phone yet', () => {
    expect(castStartAt(0, 1834)).toBe(1834);
    expect(castStartAt(0, null)).toBe(0);
  });
  it('continues where the phone is once it played', () => {
    expect(castStartAt(612.4, 1834)).toBe(612.4);
  });
});
