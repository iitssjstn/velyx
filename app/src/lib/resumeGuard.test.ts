import { describe, expect, it } from 'vitest';
import { savesOnLeave, watchedElsewhere } from './resumeGuard';

describe('a paused player does not undo what was watched elsewhere', () => {
  it('saves on leaving only when the spot moved since the last save', () => {
    expect(savesOnLeave(1200, null)).toBe(true);
    expect(savesOnLeave(1200, 1200)).toBe(false);
    expect(savesOnLeave(1201, 1200)).toBe(false);
    expect(savesOnLeave(1210, 1200)).toBe(true);
  });

  it('continues where it was watched elsewhere after a long pause', () => {
    expect(watchedElsewhere(1200, { positionSec: 3000 })).toBe(3000);
    expect(watchedElsewhere(1200, { positionSec: 600 })).toBe(600);
    expect(watchedElsewhere(1200, { positionSec: 1205 })).toBeNull();
    expect(watchedElsewhere(1200, { positionSec: 3000, completed: true })).toBeNull();
    expect(watchedElsewhere(null, { positionSec: 3000 })).toBeNull();
    expect(watchedElsewhere(1200, null)).toBeNull();
  });
});
