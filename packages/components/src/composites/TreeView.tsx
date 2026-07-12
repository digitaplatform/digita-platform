import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface TreeViewNode {
  id: string;
  label: string;
  parentId: string | null;
  subtitle?: string;
}

export interface TreeViewProps {
  /** Flat node list; the hierarchy is built from id + parentId. */
  nodes: TreeViewNode[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Case-insensitive filter; matches stay visible with their ancestors (auto-expanded). */
  query?: string;
  /** Per-row trailing controls (turns the tree into an editor: add/rename/delete/move). */
  renderActions?: (node: TreeViewNode) => ReactNode;
  emptyLabel?: string;
  className?: string;
  /** Focus the tree on mount for immediate keyboard navigation. */
  autoFocus?: boolean;
  /** Node ids that cannot be selected (rendered muted, `aria-disabled`, selection
   *  ignored) — e.g. a node and its descendants when picking a parent, so a cycle
   *  can never be chosen. Still expandable, so their subtree stays navigable. */
  disabledIds?: Set<string>;
  /** Opt-in HTML5 drag source per node: return a `dataTransfer` payload to make
   *  the row draggable (`effectAllowed` = 'copy'), or `null` for not draggable
   *  (e.g. group nodes). Omit the prop → no row is draggable (unchanged). */
  getNodeDragData?: (node: TreeViewNode) => { type: string; data: string } | null;
}

function buildChildren(nodes: TreeViewNode[]): {
  childrenOf: Map<string | null, TreeViewNode[]>;
  roots: TreeViewNode[];
} {
  const ids = new Set(nodes.map((n) => n.id));
  const childrenOf = new Map<string | null, TreeViewNode[]>();
  for (const n of nodes) {
    // A node whose parent is absent from the set is treated as a root.
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(n);
    childrenOf.set(key, list);
  }
  return { childrenOf, roots: childrenOf.get(null) ?? [] };
}

const escapeAttr = (v: string): string =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v;

/**
 * Generic hierarchical tree — builds the hierarchy from a FLAT node list
 * (id + parentId), so it serves any self-referential tree entity (categories,
 * folders, org units). Expand/collapse, single-select, a case-insensitive
 * filter that keeps matches + their ancestors visible (auto-expanded), and
 * keyboard navigation over the visible rows (Up/Down move, Left/Right collapse/
 * expand, Enter selects). Domain-agnostic: pass `renderActions` to render per-row
 * controls and turn it into a tree editor.
 */
export function TreeView({
  nodes,
  selectedId,
  onSelect,
  query = '',
  renderActions,
  emptyLabel = 'No entries',
  className,
  autoFocus,
  disabledIds,
  getNodeDragData,
}: TreeViewProps) {
  const { childrenOf, roots } = useMemo(() => buildChildren(nodes), [nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.map((n) => n.id)));
  const [activeId, setActiveId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  // A node is "visible" under a filter when it matches or any descendant does,
  // so the full path to every match stays on screen.
  const subtreeMatches = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const cache = new Map<string, boolean>();
    // A malformed `parentId` cycle (A→B→A) would otherwise recurse forever
    // (the cache is only written AFTER descending). Mark nodes in-progress and
    // treat a re-entrant visit as no-match, breaking the cycle.
    const visiting = new Set<string>();
    const visit = (id: string): boolean => {
      const hit = cache.get(id);
      if (hit !== undefined) return hit;
      if (visiting.has(id)) return false;
      visiting.add(id);
      const node = byId.get(id)!;
      let m = node.label.toLowerCase().includes(q);
      if (!m) {
        for (const c of childrenOf.get(id) ?? []) {
          if (visit(c.id)) {
            m = true;
            break;
          }
        }
      }
      visiting.delete(id);
      cache.set(id, m);
      return m;
    };
    if (q) for (const n of nodes) visit(n.id);
    return cache;
  }, [nodes, childrenOf, q]);

  const hasChildren = (id: string) => (childrenOf.get(id)?.length ?? 0) > 0;
  const isExpanded = (id: string) => (q ? true : expanded.has(id));

  // Flatten the currently-rendered rows (DFS, respecting filter + expansion) — the
  // single source of truth for both rendering and keyboard navigation.
  const flat = useMemo(() => {
    const out: { node: TreeViewNode; depth: number }[] = [];
    const vis = (id: string) => !q || subtreeMatches.get(id) === true;
    const open = (id: string) => (q ? true : expanded.has(id));
    const walk = (list: TreeViewNode[], depth: number) => {
      for (const n of list) {
        if (!vis(n.id)) continue;
        out.push({ node: n, depth });
        const kids = childrenOf.get(n.id) ?? [];
        if (kids.length > 0 && open(n.id)) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, childrenOf, expanded, q, subtreeMatches]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (activeId)
      containerRef.current
        ?.querySelector(`[data-tree-id="${escapeAttr(activeId)}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (flat.length === 0) return;
    const idx = flat.findIndex((f) => f.node.id === activeId);
    const cur = idx >= 0 ? idx : 0;
    const node = flat[cur]!.node;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveId(flat[Math.min(cur + 1, flat.length - 1)]!.node.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveId(flat[Math.max(cur - 1, 0)]!.node.id);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (hasChildren(node.id) && !isExpanded(node.id)) toggle(node.id);
      else if (hasChildren(node.id)) setActiveId((childrenOf.get(node.id) ?? [])[0]!.id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (hasChildren(node.id) && isExpanded(node.id)) toggle(node.id);
      else if (node.parentId) setActiveId(node.parentId);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!disabledIds?.has(node.id)) onSelect?.(node.id);
    }
  };

  if (nodes.length === 0) {
    return (
      <div className={cn('px-3 py-6 text-center text-sm text-textMuted', className)}>{emptyLabel}</div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'max-h-[55vh] overflow-auto rounded-card border border-border outline-none',
        className,
      )}
    >
      {flat.map(({ node, depth }) => {
        const expandable = hasChildren(node.id);
        const open = isExpanded(node.id);
        const selected = node.id === selectedId;
        const active = node.id === activeId;
        const disabled = disabledIds?.has(node.id) ?? false;
        const dragData = getNodeDragData ? getNodeDragData(node) : null;
        return (
          <div
            key={node.id}
            data-tree-id={node.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={selected}
            aria-expanded={expandable ? open : undefined}
            draggable={dragData ? true : undefined}
            onDragStart={
              dragData
                ? (e: DragEvent) => {
                    e.dataTransfer.setData(dragData.type, dragData.data);
                    e.dataTransfer.effectAllowed = 'copy';
                  }
                : undefined
            }
            className={cn(
              'group flex items-center gap-1 border-b border-border pr-2 text-sm last:border-b-0',
              active ? 'bg-bgHover' : selected && 'bg-subtle',
              dragData && 'cursor-grab active:cursor-grabbing',
            )}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-hidden={!expandable}
              onClick={() => expandable && toggle(node.id)}
              style={{ marginLeft: depth * 16 }}
              className={cn(
                'flex h-7 w-5 shrink-0 items-center justify-center text-xs text-textMuted',
                !expandable && 'invisible',
              )}
            >
              <span className={cn('transition-transform duration-base', open && 'rotate-90')}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                  <path d="M7.5 5.5l5 4.5-5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (disabled) return;
                setActiveId(node.id);
                onSelect?.(node.id);
              }}
              className={cn(
                'flex-1 truncate py-1.5 text-left',
                disabled ? 'cursor-not-allowed text-textMuted' : 'text-textMain',
                selected && 'font-semibold',
              )}
            >
              {node.label}
              {node.subtitle && <span className="ml-2 text-xs text-textMuted">{node.subtitle}</span>}
            </button>
            {renderActions && (
              <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {renderActions(node)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
