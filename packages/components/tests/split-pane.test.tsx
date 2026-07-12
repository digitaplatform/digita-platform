import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitPane } from '../src/composites/SplitPane.js';

describe('SplitPane', () => {
  beforeEach(() => window.localStorage.clear());

  it('renders both panes + a separator, and resizes by keyboard', () => {
    render(<SplitPane first={<div>Left</div>} second={<div>Right</div>} defaultSize={300} min={160} max={600} />);
    expect(screen.getByText('Left')).toBeInTheDocument();
    expect(screen.getByText('Right')).toBeInTheDocument();
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-valuenow', '300');
    expect(sep).toHaveAttribute('aria-valuemin', '160');
    expect(sep).toHaveAttribute('aria-valuemax', '600');
    fireEvent.keyDown(sep, { key: 'ArrowRight' }); // +8
    expect(sep).toHaveAttribute('aria-valuenow', '308');
    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true }); // -32
    expect(sep).toHaveAttribute('aria-valuenow', '276');
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(sep).toHaveAttribute('aria-valuenow', '160');
    fireEvent.keyDown(sep, { key: 'End' });
    expect(sep).toHaveAttribute('aria-valuenow', '600');
  });

  it('clamps to min/max and persists to localStorage under storageKey', () => {
    render(<SplitPane first={<div>L</div>} second={<div>R</div>} defaultSize={300} min={200} max={400} storageKey="k" />);
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true }); // 300-32 = 268
    expect(window.localStorage.getItem('k')).toBe('268');
    for (let i = 0; i < 20; i++) fireEvent.keyDown(sep, { key: 'ArrowRight', shiftKey: true });
    expect(sep).toHaveAttribute('aria-valuenow', '400'); // clamped at max
  });

  it('reads a persisted size on mount (clamped)', () => {
    window.localStorage.setItem('k2', '250');
    render(<SplitPane first={<div>L</div>} second={<div>R</div>} defaultSize={300} min={160} max={600} storageKey="k2" />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '250');
  });
});

describe('SplitPane resize="end" (right/second pane is the resized one)', () => {
  beforeEach(() => window.localStorage.clear());

  it('sizes the SECOND pane and mirrors the keyboard to the divider (ArrowLeft grows, Home = max)', () => {
    render(
      <SplitPane resize="end" first={<div>Left</div>} second={<div>Right</div>} defaultSize={320} min={280} max={480} storageKey="ke" />,
    );
    // The width style sits on the second pane's wrapper, not the first.
    expect(screen.getByText('Right').parentElement).toHaveStyle({ width: '320px' });
    expect(screen.getByText('Left').parentElement?.getAttribute('style')).toBeNull();
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-valuenow', '320');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' }); // divider left = panel grows
    expect(sep).toHaveAttribute('aria-valuenow', '328');
    expect(window.localStorage.getItem('ke')).toBe('328');
    fireEvent.keyDown(sep, { key: 'ArrowRight', shiftKey: true }); // divider right = panel shrinks (big step)
    expect(sep).toHaveAttribute('aria-valuenow', '296');
    fireEvent.keyDown(sep, { key: 'Home' }); // divider far left = panel at max
    expect(sep).toHaveAttribute('aria-valuenow', '480');
    fireEvent.keyDown(sep, { key: 'End' }); // divider far right = panel at min
    expect(sep).toHaveAttribute('aria-valuenow', '280');
  });

  it('mirrors the pointer drag (moving left grows the panel) and persists on release', () => {
    if (!window.HTMLElement.prototype.setPointerCapture) {
      window.HTMLElement.prototype.setPointerCapture = () => {};
    }
    render(
      <SplitPane resize="end" first={<div>L</div>} second={<div>R</div>} defaultSize={320} min={280} max={480} storageKey="kd" />,
    );
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 470, pointerId: 1 }); // 30px left → +30
    expect(sep).toHaveAttribute('aria-valuenow', '350');
    expect(window.localStorage.getItem('kd')).toBeNull(); // not yet released
    fireEvent.pointerUp(sep, { pointerId: 1 });
    expect(window.localStorage.getItem('kd')).toBe('350');
  });

  it('double-click resets to defaultSize', () => {
    window.localStorage.setItem('kr', '400');
    render(
      <SplitPane resize="end" first={<div>L</div>} second={<div>R</div>} defaultSize={320} min={280} max={480} storageKey="kr" />,
    );
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-valuenow', '400');
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute('aria-valuenow', '320');
    expect(window.localStorage.getItem('kr')).toBe('320');
  });
});

describe('SplitPane collapsed + panes="fill"', () => {
  beforeEach(() => window.localStorage.clear());

  it('collapsed unmounts the divider + resized pane; the flexible pane KEEPS its DOM node (no remount)', () => {
    const ui = (collapsed: boolean) => (
      <SplitPane resize="end" collapsed={collapsed} first={<div>Content</div>} second={<div>Panel</div>} defaultSize={320} />
    );
    const { rerender } = render(ui(false));
    const content = screen.getByText('Content');
    expect(screen.getByText('Panel')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();

    rerender(ui(true));
    expect(screen.queryByText('Panel')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByText('Content')).toBe(content); // identical node = stable tree position

    rerender(ui(false));
    expect(screen.getByText('Panel')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBe(content); // survives the expand too
  });

  it('collapsed with the default resize="start" hides the FIRST pane and keeps the second mounted', () => {
    const ui = (collapsed: boolean) => (
      <SplitPane collapsed={collapsed} first={<div>Rail</div>} second={<div>Editor</div>} />
    );
    const { rerender } = render(ui(false));
    const editor = screen.getByText('Editor');
    rerender(ui(true));
    expect(screen.queryByText('Rail')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByText('Editor')).toBe(editor);
  });

  it('panes="fill" renders single-cell grid fills (children stretch + own scrolling); default stays overflow-auto', () => {
    const { rerender } = render(<SplitPane first={<div>L</div>} second={<div>R</div>} />);
    expect(screen.getByText('L').parentElement?.className).toContain('overflow-auto');
    expect(screen.getByText('R').parentElement?.className).toContain('overflow-auto');

    rerender(<SplitPane panes="fill" first={<div>L</div>} second={<div>R</div>} />);
    // Grid fills stretch a zero-intrinsic-width child to the full pane (no 0px
    // collapse) — the flexible pane keeps flex-1 as a flex ITEM of the split row.
    expect(screen.getByText('L').parentElement?.className).not.toContain('overflow-auto');
    expect(screen.getByText('L').parentElement?.className).toContain('grid');
    expect(screen.getByText('R').parentElement?.className).not.toContain('overflow-auto');
    expect(screen.getByText('R').parentElement?.className).toContain('grid');
    expect(screen.getByText('R').parentElement?.className).toContain('flex-1');
  });
});
