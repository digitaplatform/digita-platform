import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Popover } from '../src/primitives/Popover.js';

function Host({
  onRequestClose,
  matchAnchorWidth,
}: {
  onRequestClose: () => void;
  matchAnchorWidth?: boolean;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open] = useState(true);
  return (
    <div data-testid="host-parent">
      <button ref={anchorRef} data-testid="anchor">
        anchor
      </button>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onRequestClose={onRequestClose}
        matchAnchorWidth={matchAnchorWidth}
      >
        <div data-testid="popover-content">content</div>
      </Popover>
    </div>
  );
}

describe('Popover', () => {
  it('portals its children to document.body (not the anchor parent)', () => {
    render(<Host onRequestClose={() => {}} />);
    const content = screen.getByTestId('popover-content');
    expect(screen.getByTestId('host-parent')).not.toContainElement(content);
    expect(document.body).toContainElement(content);
  });

  it('closes on pointerdown outside, but not inside or on the anchor', () => {
    const onClose = vi.fn();
    render(<Host onRequestClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('popover-content'));
    fireEvent.pointerDown(screen.getByTestId('anchor'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('consumes Escape (preventDefault) and requests close', () => {
    const onClose = vi.fn();
    render(<Host onRequestClose={onClose} />);
    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(evt);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('matches the anchor width when matchAnchorWidth is set', () => {
    render(<Host onRequestClose={() => {}} matchAnchorWidth />);
    // jsdom has no layout: mock the anchor rect AFTER mount, then re-place via resize.
    const anchor = screen.getByTestId('anchor');
    anchor.getBoundingClientRect = () =>
      ({ top: 10, bottom: 30, left: 5, right: 227, width: 222, height: 20 }) as DOMRect;
    fireEvent(window, new Event('resize'));
    const panel = screen.getByTestId('popover-content').parentElement!;
    expect(panel.style.width).toBe('222px');
  });
});
