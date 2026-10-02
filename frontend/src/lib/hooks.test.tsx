import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { useKeepOnScreen, useScrollToTopOnNavigate } from './hooks';

function Menu({ left, width }: { left: number; width: number }) {
  const ref = useKeepOnScreen<HTMLDivElement>(true);
  return (
    <div
      data-testid="menu"
      ref={(el) => {
        if (el) el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 100, height: 100, x: left, y: 0, toJSON: () => ({}) });
        ref.current = el;
      }}
    />
  );
}

describe('useKeepOnScreen', () => {
  // jsdom's window is 1024 pixels wide.
  it('leaves a menu that fits alone', () => {
    const { getByTestId } = render(<Menu left={100} width={240} />);
    expect(getByTestId('menu').style.translate).toBe('');
  });

  it('moves a menu back from the right edge', () => {
    const { getByTestId } = render(<Menu left={900} width={240} />);
    expect(getByTestId('menu').style.translate).toBe('-124px 0');
  });

  it('moves a menu back from the left edge', () => {
    const { getByTestId } = render(<Menu left={-176} width={240} />);
    expect(getByTestId('menu').style.translate).toBe('184px 0');
  });
});

describe('useScrollToTopOnNavigate', () => {
  function Page() {
    useScrollToTopOnNavigate();
    const navigate = useNavigate();
    return (
      <>
        <button onClick={() => navigate('/shows/1')}>open</button>
        <button onClick={() => navigate('/shows/1?season=2')}>season</button>
        <button onClick={() => navigate(-1)}>back</button>
      </>
    );
  }

  it('opens a new page at the top, but not on going back or on a change of only the query', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<Page />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('open'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
    fireEvent.click(screen.getByText('season'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('back'));
    fireEvent.click(screen.getByText('back'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
