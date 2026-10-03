// The tree the kit draws for every consumer: a long tree mounts only the rows in view, siblings sort
// by their place and then by label, and a consumer draws a node's label, icon, picture and badge.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TreeView, type TreeViewNode } from '../src/composites/TreeView.js';

// jsdom lays nothing out: the scroll box answers a height, as a browser would, so the long tree
// has a view to fill.
const RECT = { width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => RECT;
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const size = [{ inlineSize: RECT.width, blockSize: RECT.height }];
      const entry = { target, contentRect: RECT, borderBoxSize: size, contentBoxSize: size };
      this.cb([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  globalThis.ResizeObserver = origRO;
});

describe('TreeView', () => {
  it('PLANTED DEFECT: mounts only the rows in view of a tree of 5,000 nodes', () => {
    const nodes: TreeViewNode[] = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, parentId: null }));
    render(<TreeView nodes={nodes} />);
    const mounted = screen.getAllByRole('treeitem').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
  });

  it('mounts a small tree whole', () => {
    const nodes: TreeViewNode[] = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, parentId: null }));
    render(<TreeView nodes={nodes} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(40);
  });

  it('PLANTED DEFECT: sorts siblings by their place, then by label', () => {
    const nodes: TreeViewNode[] = [
      { id: 'c', label: 'Charlie', parentId: null, position: 1 },
      { id: 'b', label: 'Bravo', parentId: null, position: 2 },
      { id: 'a', label: 'Alpha', parentId: null, position: 1 },
    ];
    render(<TreeView nodes={nodes} />);
    expect(screen.getAllByRole('treeitem').map((item) => item.textContent)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it("draws a consumer's label, icon, picture and badge", () => {
    const nodes: TreeViewNode[] = [
      { id: 'a', label: 'Brakes', parentId: null, icon: <svg data-testid="icon" />, imageUrl: '/brakes.png', badge: 12, muted: true },
    ];
    render(<TreeView nodes={nodes} renderLabel={(node) => <em>{node.label.toUpperCase()}</em>} />);
    const row = screen.getByRole('treeitem');
    expect(within(row).getByText('BRAKES').tagName).toBe('EM');
    expect(within(row).getByTestId('icon')).toBeInTheDocument();
    expect(row.querySelector('img')).toHaveAttribute('src', '/brakes.png');
    expect(row).toHaveTextContent('12');
  });
});
