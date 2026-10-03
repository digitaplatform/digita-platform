import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../primitives/Button.js';
import { IconButton } from '../primitives/IconButton.js';
import { Input } from '../primitives/Input.js';
import { Select } from '../primitives/Select.js';
import { TreeView, type TreeViewNode } from './TreeView.js';

export interface TreeEditorNode extends TreeViewNode {
  /** The tree the node belongs to, where the entity holds one tree per kind. */
  kind?: string;
}

/** The editor's texts, localized by the caller. */
export interface TreeEditorLabels {
  kind: string;
  newKind: string;
  kindName: string;
  create: string;
  addRoot: string;
  addChild: string;
  move: string;
  moveToRoot: string;
  movingHint: string;
  cancel: string;
  delete: string;
  search: string;
  noResults: string;
  select: string;
}

export interface TreeEditorProps {
  nodes: TreeEditorNode[];
  /** The nodes carry a `kind`: the editor lists the kinds they carry and shows one tree at a time. */
  hasKinds?: boolean;
  labels: TreeEditorLabels;
  canCreate?: boolean;
  canMove?: (node: TreeEditorNode) => boolean;
  canDelete?: (node: TreeEditorNode) => boolean;
  /** A new node under `parentId` (null = a root) of `kind`; `ancestry` holds the labels from the root down to the parent. */
  onAdd: (target: { parentId: string | null; kind?: string; ancestry: string[] }) => void;
  /** A person picked the node to edit; `ancestry` holds the labels from the root down to its parent. */
  onEdit: (target: { id: string; ancestry: string[] }) => void;
  onMove: (id: string, parentId: string | null) => Promise<void>;
  onDelete: (node: TreeEditorNode) => Promise<void>;
  expandedIds?: Set<string>;
  onExpandedChange?: (id: string, expanded: boolean) => void;
  renderLabel?: (node: TreeViewNode) => ReactNode;
}

/**
 * The editor of one tree, props-only: the caller loads the nodes and carries out an add, an edit, a
 * move and a delete. A move is click-to-move: the moving node and its subtree cannot be picked, so
 * no cycle can be chosen.
 */
export function TreeEditor({
  nodes,
  hasKinds = false,
  labels,
  canCreate = false,
  canMove = () => false,
  canDelete = () => false,
  onAdd,
  onEdit,
  onMove,
  onDelete,
  expandedIds,
  onExpandedChange,
  renderLabel,
}: TreeEditorProps) {
  const [chosenKind, setChosenKind] = useState<string | null>(null);
  const [newKindName, setNewKindName] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const kinds = useMemo(() => {
    const carried = new Set(nodes.map((n) => n.kind).filter((k): k is string => !!k));
    // A kind a person just named has no node until its first node is saved.
    if (chosenKind) carried.add(chosenKind);
    return [...carried].sort((a, b) => a.localeCompare(b));
  }, [nodes, chosenKind]);
  const kind = hasKinds ? (chosenKind ?? kinds[0] ?? '') : undefined;
  const shown = useMemo(() => (hasKinds ? nodes.filter((n) => n.kind === kind) : nodes), [nodes, hasKinds, kind]);
  const byId = useMemo(() => new Map(shown.map((n) => [n.id, n])), [shown]);

  const pathTo = (id: string | null): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur = id ? byId.get(id) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.push(cur.label);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out.reverse();
  };

  const blocked = useMemo(() => {
    if (!movingId) return new Set<string>();
    const kids = new Map<string, string[]>();
    for (const n of shown) {
      if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
    }
    const out = new Set<string>([movingId]);
    const stack = [movingId];
    while (stack.length) {
      for (const c of kids.get(stack.pop()!) ?? []) {
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
      }
    }
    return out;
  }, [movingId, shown]);

  const add = (parentId: string | null) => {
    // A new child under a closed node would not show.
    if (parentId) onExpandedChange?.(parentId, true);
    onAdd({ parentId, kind, ancestry: pathTo(parentId) });
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const moveTo = (parentId: string | null) => {
    if (!movingId) return;
    const id = movingId;
    setMovingId(null);
    void run(async () => {
      await onMove(id, parentId);
      // A node moved under a closed node would drop out of view.
      if (parentId) onExpandedChange?.(parentId, true);
    });
  };

  const createKind = (e: FormEvent) => {
    e.preventDefault();
    const name = newKindName?.trim();
    if (!name) return;
    setNewKindName(null);
    setChosenKind(name);
    onAdd({ parentId: null, kind: name, ancestry: [] });
  };

  const disabled = busy || !!movingId;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {hasKinds && kinds.length > 0 && (
          <div className="w-48">
            <Select
              aria-label={labels.kind}
              value={kind ?? ''}
              onChange={setChosenKind}
              options={kinds.map((k) => ({ value: k, label: k }))}
            />
          </div>
        )}
        {canCreate && (!hasKinds || kind) && (
          <Button variant="secondary" disabled={disabled} onClick={() => add(null)}>
            + {labels.addRoot}
          </Button>
        )}
        {canCreate && hasKinds && newKindName === null && (
          <Button variant="ghost" disabled={disabled} onClick={() => setNewKindName('')}>
            + {labels.newKind}
          </Button>
        )}
        {newKindName !== null && (
          <form className="flex items-center gap-2" onSubmit={createKind}>
            <Input
              type="text"
              aria-label={labels.kindName}
              placeholder={labels.kindName}
              value={newKindName}
              autoFocus
              onChange={(e) => setNewKindName(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!newKindName.trim()}>
              {labels.create}
            </Button>
            <Button variant="ghost" onClick={() => setNewKindName(null)}>
              {labels.cancel}
            </Button>
          </form>
        )}
        {movingId && (
          <div className="flex items-center gap-2 rounded-card bg-subtle px-3 py-1.5 text-sm">
            <span className="text-textMuted">{labels.movingHint}</span>
            <Button variant="ghost" onClick={() => moveTo(null)}>
              {labels.moveToRoot}
            </Button>
            <Button variant="ghost" onClick={() => setMovingId(null)}>
              {labels.cancel}
            </Button>
          </div>
        )}
      </div>

      <Input
        type="text"
        role="searchbox"
        aria-label={labels.search}
        placeholder={labels.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <TreeView
        nodes={shown}
        // A search writes no open groups: the tree opens a match's ancestors only while it searches,
        // so clearing the search shows the groups as the person left them.
        query={query}
        emptyLabel={labels.noResults}
        expandedIds={expandedIds}
        onExpandedChange={onExpandedChange}
        renderLabel={renderLabel}
        // While a node moves, a name opens its group and the row's Select button moves the node
        // there, as in a picker; the node and its subtree cannot be picked.
        expandOnNameClick={movingId !== null}
        selectLabel={labels.select}
        disabledIds={blocked}
        onSelect={(id) => {
          if (movingId) {
            moveTo(id);
            return;
          }
          onEdit({ id, ancestry: pathTo(byId.get(id)?.parentId ?? null) });
        }}
        renderActions={(node) => {
          const own = byId.get(node.id) ?? node;
          return (
            <>
              {canCreate && (
                <IconButton
                  label={labels.addChild}
                  size="sm"
                  disabled={disabled}
                  onClick={() => add(node.id)}
                  icon={<span aria-hidden>＋</span>}
                />
              )}
              {canMove(own) && (
                <IconButton
                  label={labels.move}
                  size="sm"
                  disabled={disabled}
                  onClick={() => setMovingId(node.id)}
                  icon={<span aria-hidden>↕</span>}
                />
              )}
              {canDelete(own) && (
                <IconButton
                  label={labels.delete}
                  size="sm"
                  variant="danger"
                  disabled={disabled}
                  onClick={() => void run(() => onDelete(own))}
                  icon={<span aria-hidden>🗑</span>}
                />
              )}
            </>
          );
        }}
      />
    </div>
  );
}
