import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorageWarning } from './Dashboard';

const GB = 1024 ** 3;

describe('StorageWarning', () => {
  it('shows nothing while space is fine', () => {
    const { container } = render(<StorageWarning disk={{ total: 500 * GB, used: 100 * GB, free: 400 * GB, level: 'ok' }} />);
    expect(container.textContent).toBe('');
  });

  it('warns when space is low', () => {
    render(<StorageWarning disk={{ total: 500 * GB, used: 492 * GB, free: 8 * GB, level: 'low' }} />);
    expect(screen.getByRole('alert').textContent).toContain('Storage running low');
  });

  it('explains that scans pause when space is critical', () => {
    render(<StorageWarning disk={{ total: 500 * GB, used: 498.6 * GB, free: 1.4 * GB, level: 'critical' }} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Storage critically low');
    expect(alert.textContent).toContain('1.4 GB remaining');
    expect(alert.textContent).toContain('scans and scheduled backups are paused');
  });
});
