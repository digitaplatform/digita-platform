// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import { TreeView, type TreeViewNode } from '@digitaplatform/components';

const nodes: TreeViewNode[] = [
  { id: 'a', label: 'Beverages', parentId: null },
  { id: 'b', label: 'Juices', parentId: 'a' },
  { id: 'c', label: 'Apple juice', parentId: 'b' },
  { id: 'd', label: 'Dairy', parentId: null },
];

describe('TreeView', () => {
  it('builds the hierarchy from flat nodes (expanded by default)', () => {
    render(<TreeView nodes={nodes} />);
    expect(screen.getByText('Beverages')).toBeTruthy();
    expect(screen.getByText('Apple juice')).toBeTruthy();
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
  });

  it('reports the chosen node id on click', () => {
    const onSelect = vi.fn();
    render(<TreeView nodes={nodes} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Apple juice'));
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('does not select a disabled node (cycle-block) but still selects enabled ones', () => {
    const onSelect = vi.fn();
    render(<TreeView nodes={nodes} onSelect={onSelect} disabledIds={new Set(['b', 'c'])} />);
    fireEvent.click(screen.getByText('Juices')); // disabled → ignored
    fireEvent.click(screen.getByText('Apple juice')); // disabled → ignored
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Dairy')); // enabled → selects
    expect(onSelect).toHaveBeenCalledWith('d');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('filters to matches and keeps their ancestors, hides other branches', () => {
    render(<TreeView nodes={nodes} query="apple" />);
    expect(screen.getByText('Apple juice')).toBeTruthy();
    expect(screen.getByText('Beverages')).toBeTruthy(); // ancestor kept
    expect(screen.getByText('Juices')).toBeTruthy(); // ancestor kept
    expect(screen.queryByText('Dairy')).toBeNull(); // non-matching branch hidden
  });

  it('renders per-node actions for editor mode', () => {
    render(<TreeView nodes={nodes} renderActions={(n) => <span>act-{n.id}</span>} />);
    expect(screen.getByText('act-a')).toBeTruthy();
  });

  it('survives a parentId cycle under a filter query (no stack overflow)', () => {
    const cyclic: TreeViewNode[] = [
      { id: 'root', label: 'Root', parentId: null },
      { id: 'x', label: 'Xylophone', parentId: 'y' }, // x <-> y form a cycle
      { id: 'y', label: 'Yak', parentId: 'x' },
    ];
    // A filter query runs the subtree-match walk over EVERY node incl. the
    // cycle; without the in-progress guard this recurses until the stack blows.
    expect(() => render(<TreeView nodes={cyclic} query="root" />)).not.toThrow();
    expect(screen.getByText('Root')).toBeTruthy();
  });
});
