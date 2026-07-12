import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { TabBar, type TabBarItem } from '../src/composites/TabBar.js';

function makeItems(n: number, onSelect = vi.fn()): { items: TabBarItem[]; onSelect: ReturnType<typeof vi.fn> } {
  const items = Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    label: `Item ${i}`,
    icon: <svg data-testid={`icon-${i}`} />,
    onSelect: () => onSelect(`k${i}`),
  }));
  return { items, onSelect };
}

describe('TabBar', () => {
  it('renders a labelled nav with one target per item and forwards the ref', () => {
    const ref = createRef<HTMLElement>();
    const { items } = makeItems(4);
    render(<TabBar ref={ref} items={items} activeKey="k0" />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toHaveAttribute('data-ui', 'tab-bar');
    expect(ref.current).toBe(nav);
    const targets = nav.querySelectorAll('[data-ui="tab-bar-item"]');
    expect(targets).toHaveLength(4);
    // icon + label per target
    expect(targets[1]!.querySelector('[data-ui="tab-bar-icon"]')).toContainElement(screen.getByTestId('icon-1'));
    expect(targets[1]!.querySelector('[data-ui="tab-bar-label"]')).toHaveTextContent('Item 1');
  });

  it('marks ONLY the active target with aria-current="page" + data-active', () => {
    const { items } = makeItems(3);
    render(<TabBar items={items} activeKey="k1" />);
    const active = screen.getByRole('button', { name: 'Item 1' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveAttribute('data-active');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Item 0' })).not.toHaveAttribute('aria-current');
  });

  it('swaps in the filled activeIcon on the active target only', () => {
    const items: TabBarItem[] = [
      { key: 'a', label: 'A', icon: <svg data-testid="a-outline" />, activeIcon: <svg data-testid="a-filled" />, onSelect: vi.fn() },
      { key: 'b', label: 'B', icon: <svg data-testid="b-outline" />, activeIcon: <svg data-testid="b-filled" />, onSelect: vi.fn() },
    ];
    render(<TabBar items={items} activeKey="a" />);
    expect(screen.getByTestId('a-filled')).toBeInTheDocument();
    expect(screen.queryByTestId('a-outline')).not.toBeInTheDocument();
    expect(screen.getByTestId('b-outline')).toBeInTheDocument();
    expect(screen.queryByTestId('b-filled')).not.toBeInTheDocument();
  });

  it('fires onSelect on click and via the keyboard (Enter)', async () => {
    const { items, onSelect } = makeItems(3);
    render(<TabBar items={items} activeKey="k0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Item 2' }));
    expect(onSelect).toHaveBeenCalledWith('k2');
    screen.getByRole('button', { name: 'Item 1' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('k1');
  });

  it('moves focus with the arrow keys, wrapping at the ends', () => {
    const { items } = makeItems(3);
    render(<TabBar items={items} activeKey="k0" />);
    const [b0, b1, b2] = screen.getAllByRole('button');
    b0!.focus();
    fireEvent.keyDown(b0!, { key: 'ArrowRight' });
    expect(b1).toHaveFocus();
    fireEvent.keyDown(b1!, { key: 'ArrowLeft' });
    expect(b0).toHaveFocus();
    fireEvent.keyDown(b0!, { key: 'ArrowLeft' }); // wrap
    expect(b2).toHaveFocus();
    fireEvent.keyDown(b2!, { key: 'Home' });
    expect(b0).toHaveFocus();
    fireEvent.keyDown(b0!, { key: 'End' });
    expect(b2).toHaveFocus();
  });

  it('collapses >5 items to the first 4 + a "More" target firing onMore', () => {
    const { items, onSelect } = makeItems(7);
    const onMore = vi.fn();
    render(<TabBar items={items} activeKey="k0" onMore={onMore} />);
    const targets = screen.getAllByRole('button');
    expect(targets).toHaveLength(5); // 4 items + More
    expect(screen.getByRole('button', { name: 'Item 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Item 4' })).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('data-ui', 'tab-bar-item');
    expect(more).toHaveAttribute('data-more');
    fireEvent.click(more);
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('lights "More" up (data-active, NO aria-current) when the active key is collapsed into it', () => {
    const { items } = makeItems(7);
    render(<TabBar items={items} activeKey="k6" onMore={vi.fn()} />);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('data-active');
    expect(more).not.toHaveAttribute('aria-current');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('renders exactly 5 targets without a More when given exactly 5 items', () => {
    const { items } = makeItems(5);
    render(<TabBar items={items} activeKey="k0" />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });
});
