import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LibraryCompatibilityCard } from './Compatibility';

describe('LibraryCompatibilityCard', () => {
  it('shows verdict counts, common problems and health', () => {
    render(
      <MemoryRouter>
        <LibraryCompatibilityCard
          lib={{
            id: 1,
            name: 'Movies',
            type: 'movies',
            files: 4281,
            verdicts: { direct: 3721, remux: 421, 'browser-dependent': 100, incompatible: 39, unknown: 0 },
            issues: [{ label: 'HEVC video', count: 139 }, { label: 'Image subtitles (PGS/VobSub)', count: 88 }],
            notAnalyzed: 0,
            health: { probeErrors: 2, unmatched: 0 },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('4,281 files')).toBeTruthy();
    expect(screen.getByText('3,721')).toBeTruthy();
    expect(screen.getByText('421')).toBeTruthy();
    expect(screen.getByText('HEVC video')).toBeTruthy();
    expect(document.body.textContent).toContain('2 unreadable files');
    // "Not analysed" only appears when there are such files.
    expect(screen.queryByText('Not analysed')).toBeNull();
  });
});
