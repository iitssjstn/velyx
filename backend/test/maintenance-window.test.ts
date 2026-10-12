import { describe, expect, it } from 'vitest';
import { inMaintenanceWindow, TIME_OF_DAY } from '../src/services/maintenance-window.js';

const at = (h: number, m = 0) => new Date(2026, 9, 12, h, m);

describe('maintenance window', () => {
  it('covers start up to (not including) end on the same day', () => {
    expect(inMaintenanceWindow(at(1, 59), '02:00', '06:00')).toBe(false);
    expect(inMaintenanceWindow(at(2), '02:00', '06:00')).toBe(true);
    expect(inMaintenanceWindow(at(5, 59), '02:00', '06:00')).toBe(true);
    expect(inMaintenanceWindow(at(6), '02:00', '06:00')).toBe(false);
  });

  it('runs past midnight', () => {
    expect(inMaintenanceWindow(at(23), '22:30', '04:00')).toBe(true);
    expect(inMaintenanceWindow(at(3, 30), '22:30', '04:00')).toBe(true);
    expect(inMaintenanceWindow(at(12), '22:30', '04:00')).toBe(false);
    expect(inMaintenanceWindow(at(22, 29), '22:30', '04:00')).toBe(false);
  });

  it('accepts only 24-hour times', () => {
    for (const ok of ['00:00', '02:30', '23:59']) expect(TIME_OF_DAY.test(ok)).toBe(true);
    for (const bad of ['24:00', '2:00', '02:60', '02:00:00', '']) expect(TIME_OF_DAY.test(bad)).toBe(false);
  });
});
