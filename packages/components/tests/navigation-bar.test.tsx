import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { NavigationBar, type NavigationBarItem } from '../src/composites/NavigationBar.js';

function makeItems(n: number, onSelect = vi.fn()): { items: NavigationBarItem[]; onSelect: ReturnType<typeof vi.fn> } {
  const items = Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    label: `Item ${i}`,
    icon: <svg data-testid={`icon-${i}`} />,
    onSelect: () => onSelect(`k${i}`),
  }));
  return { items, onSelect };
}

describe('NavigationBar', () => {
  it('renders a labelled nav with indicator + label per target and forwards the ref', () => {
    const ref = createRef<HTMLElement>();
    const { items } = makeItems(4);
    render(<NavigationBar ref={ref} items={items} activeKey="k0" />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toHaveAttribute('data-ui', 'nav-bar');
    expect(ref.current).toBe(nav);
    const targets = nav.querySelectorAll('[data-ui="nav-bar-item"]');
    expect(targets).toHaveLength(4);
    // The icon sits INSIDE the pill indicator slot; the label below it.
    const indicator = targets[1]!.querySelector('[data-ui="nav-bar-indicator"]');
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
    expect(indicator).toContainElement(screen.getByTestId('icon-1'));
    expect(targets[1]!.querySelector('[data-ui="nav-bar-label"]')).toHaveTextContent('Item 1');
  });

  it('marks ONLY the active target with aria-current="page" + data-active', () => {
    const { items } = makeItems(3);
    render(<NavigationBar items={items} activeKey="k2" />);
    const active = screen.getByRole('button', { name: 'Item 2' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveAttribute('data-active');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Item 0' })).not.toHaveAttribute('aria-current');
  });

  it('swaps in the filled activeIcon on the active target only', () => {
    const items: NavigationBarItem[] = [
      { key: 'a', label: 'A', icon: <svg data-testid="a-outline" />, activeIcon: <svg data-testid="a-filled" />, onSelect: vi.fn() },
      { key: 'b', label: 'B', icon: <svg data-testid="b-outline" />, activeIcon: <svg data-testid="b-filled" />, onSelect: vi.fn() },
    ];
    render(<NavigationBar items={items} activeKey="b" />);
    expect(screen.getByTestId('b-filled')).toBeInTheDocument();
    expect(screen.queryByTestId('b-outline')).not.toBeInTheDocument();
    expect(screen.getByTestId('a-outline')).toBeInTheDocument();
  });

  it('fires onSelect on click and via the keyboard (Enter)', async () => {
    const { items, onSelect } = makeItems(3);
    render(<NavigationBar items={items} activeKey="k0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Item 1' }));
    expect(onSelect).toHaveBeenCalledWith('k1');
    screen.getByRole('button', { name: 'Item 2' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('k2');
  });

  it('moves focus with the arrow keys, wrapping at the ends', () => {
    const { items } = makeItems(3);
    render(<NavigationBar items={items} activeKey="k0" />);
    const [b0, b1, b2] = screen.getAllByRole('button');
    b0!.focus();
    fireEvent.keyDown(b0!, { key: 'ArrowRight' });
    expect(b1).toHaveFocus();
    fireEvent.keyDown(b1!, { key: 'ArrowRight' });
    expect(b2).toHaveFocus();
    fireEvent.keyDown(b2!, { key: 'ArrowRight' }); // wrap
    expect(b0).toHaveFocus();
    fireEvent.keyDown(b0!, { key: 'End' });
    expect(b2).toHaveFocus();
  });

  it('collapses >5 items to the first 4 + a "More" target firing onMore (same rule as TabBar)', () => {
    const { items } = makeItems(6);
    const onMore = vi.fn();
    render(<NavigationBar items={items} activeKey="k5" onMore={onMore} />);
    expect(screen.getAllByRole('button')).toHaveLength(5); // 4 items + More
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('data-more');
    // k5 is hidden inside More → More lights up without claiming the page.
    expect(more).toHaveAttribute('data-active');
    expect(more).not.toHaveAttribute('aria-current');
    fireEvent.click(more);
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});
