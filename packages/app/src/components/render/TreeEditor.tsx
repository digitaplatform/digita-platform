import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EntityDefinition, TreeConfig } from '@digitaplatform/shared';
import { TreeView, Button, IconButton, Input, Select, type TreeViewNode } from '@digitaplatform/components';
import { useList } from '@/hooks/useList';
import { updateDoc, deleteDoc } from '@/services/resource';
import { RecordDialog } from '@/components/record/RecordDialog';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useChrome } from '@/lib/chrome-i18n';
import { qkPrefix } from '@/lib/query-keys';
import { useUiStore } from '@/stores/ui';
import { LoadingBlock, ErrorBlock } from '@/components/status';
import { optionList } from '@/controls/SelectControl';

type Row = Record<string, unknown>;

/**
 * Generic, metadata-driven tree editor for any self-referential tree entity
 * (declared via EntityDefinition.tree). Loads the whole (small) tree — one
 * `group_by` partition at a time when configured — and lets the operator add a
 * child or top-level node, delete a leaf, re-parent (click-to-move, cycle-guarded)
 * and edit a node's record IN A MODAL (the tree stays in view — no navigating
 * away). Built on the generic TreeView + RecordDialog + the resource endpoints;
 * no entity-specific code.
 */
export function TreeEditor({
  entity,
  meta,
  tree,
}: {
  entity: string;
  meta: EntityDefinition;
  tree: TreeConfig;
}) {
  const qc = useQueryClient();
  const dialog = useDialogHost();
  const tc = useChrome();

  const labelField = tree.label_field ?? meta.title_field ?? '_id';
  const parentField = tree.parent_field;
  const orderField = tree.order_field ?? labelField;

  const groupField = tree.group_by ? meta.fields.find((f) => f.fieldname === tree.group_by) : undefined;
  const groupOptions = optionList(groupField?.options);
  const [group, setGroup] = useState(groupOptions[0] ?? '');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  // The record being edited/created in the modal (null = closed). `name` set =
  // edit; only `seed` set = create with those pre-fills.
  const [editing, setEditing] = useState<{ name?: string; seed?: Row; ancestry?: string[] } | null>(
    null,
  );
  const collapsedIds = useUiStore((s) => s.treeEditorCollapsedIds[entity]);
  const setTreeEditorCollapsedIds = useUiStore((s) => s.setTreeEditorCollapsedIds);
  // Read from the store at the call: a move opens its target node only after the server answered,
  // and the person may have opened or closed nodes meanwhile.
  const setNodeExpanded = (id: string, expanded: boolean) => {
    const ids = new Set(useUiStore.getState().treeEditorCollapsedIds[entity]);
    if (expanded) ids.delete(id);
    else ids.add(id);
    setTreeEditorCollapsedIds(entity, ids);
  };

  const listQ = useList<Row>(entity, {
    filters: tree.group_by && group ? [[tree.group_by, '=', group]] : [],
    page_size: 2000,
    order_by: `${orderField} asc`,
  });
  const rows = useMemo(() => listQ.data?.rows ?? [], [listQ.data]);

  const modifiedById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(String(r._id), String(r.modified ?? ''));
    return m;
  }, [rows]);

  const nodes: TreeViewNode[] = useMemo(
    () =>
      rows.map((r) => {
        const parent = r[parentField];
        return {
          id: String(r._id),
          label: String(r[labelField] ?? r._id),
          parentId: parent != null && parent !== '' ? String(parent) : null,
        };
      }),
    [rows, parentField, labelField],
  );

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // Every node is open until a person closes it, so a node that arrives with an add, a move or
  // another partition opens like the others.
  const expandedIds = useMemo(
    () => new Set(nodes.filter((n) => !collapsedIds?.has(n.id)).map((n) => n.id)),
    [nodes, collapsedIds],
  );

  // Labels from the root down to (and including) `id` — the ancestry breadcrumb
  // so the operator sees where a node sits. Cycle-guarded.
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

  // Descendants (incl. self) of the node being moved — invalid drop targets (cycle).
  const blocked = useMemo(() => {
    if (!movingId) return new Set<string>();
    const kids = new Map<string, string[]>();
    for (const n of nodes) {
      if (n.parentId) {
        const list = kids.get(n.parentId) ?? [];
        list.push(n.id);
        kids.set(n.parentId, list);
      }
    }
    const out = new Set<string>([movingId]);
    const stack = [movingId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of kids.get(cur) ?? []) {
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
      }
    }
    return out;
  }, [movingId, nodes]);

  const refetch = () => qc.invalidateQueries({ queryKey: qkPrefix.lists(entity) });

  /** Open the modal to CREATE a node under `parentId` (null = root), with the
   *  parent + active group partition pre-filled and the ancestry shown. */
  const openCreate = (parentId: string | null) => {
    const seed: Row = {};
    if (parentId) {
      seed[parentField] = parentId;
      // A new child under a closed node would not show.
      setNodeExpanded(parentId, true);
    }
    if (tree.group_by && group) seed[tree.group_by] = group;
    setEditing({ seed, ancestry: pathTo(parentId) });
  };

  const removeNode = async (node: TreeViewNode) => {
    if (nodes.some((n) => n.parentId === node.id)) {
      dialog.toast(tc('ui.tree.hasChildren'), 'warning');
      return;
    }
    const ok = await dialog.confirm({
      title: tc('ui.tree.deleteTitle', { name: node.label }),
      danger: true,
      confirmLabel: tc('ui.action.delete'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteDoc(entity, node.id);
      await refetch();
    } catch (e) {
      dialog.toast(e instanceof Error ? e.message : tc('ui.status.somethingWrong'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const moveTo = async (targetParentId: string | null) => {
    if (!movingId) return;
    const id = movingId;
    setMovingId(null);
    setBusy(true);
    try {
      await updateDoc(entity, id, { [parentField]: targetParentId }, modifiedById.get(id) || undefined);
      // A node moved under a closed node would drop out of view.
      if (targetParentId) setNodeExpanded(targetParentId, true);
      await refetch();
    } catch (e) {
      dialog.toast(e instanceof Error ? e.message : tc('ui.status.somethingWrong'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (listQ.isLoading) return <LoadingBlock />;
  if (listQ.isError)
    return (
      <ErrorBlock
        title={tc('ui.list.loadFailed')}
        detail={listQ.error instanceof Error ? listQ.error.message : ''}
      />
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {groupOptions.length > 0 && (
          <div className="w-48">
            <Select
              aria-label={groupField?.label ?? tree.group_by}
              value={group}
              onChange={setGroup}
              options={groupOptions.map((o) => ({ value: o, label: o }))}
            />
          </div>
        )}
        <Button variant="secondary" disabled={busy || !!movingId} onClick={() => openCreate(null)}>
          + {tc('ui.tree.addRoot')}
        </Button>
        {movingId && (
          <div className="flex items-center gap-2 rounded-card bg-subtle px-3 py-1.5 text-sm">
            <span className="text-textMuted">{tc('ui.tree.movingHint')}</span>
            <Button variant="ghost" onClick={() => void moveTo(null)}>
              {tc('ui.tree.moveToRoot')}
            </Button>
            <Button variant="ghost" onClick={() => setMovingId(null)}>
              {tc('ui.action.cancel')}
            </Button>
          </div>
        )}
      </div>

      <Input
        type="text"
        role="searchbox"
        aria-label={tc('ui.list.search')}
        placeholder={tc('ui.list.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <TreeView
        nodes={nodes}
        // A search writes no open groups: the tree opens a match's ancestors only while it searches,
        // so clearing the search shows the groups as the person left them.
        query={query}
        emptyLabel={tc('ui.select.noResults')}
        expandedIds={expandedIds}
        onExpandedChange={setNodeExpanded}
        // While a node moves, a name opens its group and the row's Select button moves the node
        // there, as in a picker; the node and its subtree cannot be picked.
        expandOnNameClick={movingId !== null}
        selectLabel={tc('ui.tree.select')}
        disabledIds={blocked}
        onSelect={(id) => {
          if (movingId) {
            void moveTo(id);
            return;
          }
          const node = byId.get(id);
          setEditing({ name: id, ancestry: pathTo(node?.parentId ?? null) });
        }}
        renderActions={(node) => (
          <>
            <IconButton
              label={tc('ui.tree.addChild')}
              size="sm"
              disabled={busy || !!movingId}
              onClick={() => openCreate(node.id)}
              icon={<span aria-hidden>＋</span>}
            />
            <IconButton
              label={tc('ui.tree.move')}
              size="sm"
              disabled={busy || !!movingId}
              onClick={() => setMovingId(node.id)}
              icon={<span aria-hidden>↕</span>}
            />
            <IconButton
              label={tc('ui.action.delete')}
              size="sm"
              variant="danger"
              disabled={busy || !!movingId}
              onClick={() => void removeNode(node)}
              icon={<span aria-hidden>🗑</span>}
            />
          </>
        )}
      />

      {editing && (
        <RecordDialog
          open
          onClose={() => setEditing(null)}
          entity={entity}
          meta={meta}
          name={editing.name}
          seed={editing.seed}
          ancestry={editing.ancestry}
          onSaved={() => void refetch()}
        />
      )}
    </div>
  );
}
