import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useKeepOnScreen } from './hooks';

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
