import { TREE_ACTIVE_FIELD, TREE_KIND_FIELD, TREE_PARENT_FIELD } from '@digitaplatform/shared';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EntityDefinition, TreeConfig } from '@digitaplatform/shared';
import { TreeEditor, type TreeEditorNode } from '@digitaplatform/components';
import { useList } from '@/hooks/useList';
import { treeNodeOf } from '@/lib/tree-node';
import { updateDoc, deleteDoc } from '@/services/resource';
import { RecordDialog } from '@/components/record/RecordDialog';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useChrome } from '@/lib/chrome-i18n';
import { qkPrefix } from '@/lib/query-keys';
import { useUiStore } from '@/stores/ui';
import { LoadingBlock, ErrorBlock } from '@/components/status';
import { hasEntityPermission, hasRecordPermission } from '@/lib/permissions';
import { useSessionStore } from '@/stores/session';

type Row = Record<string, unknown>;

/**
 * The kit's tree editor on the records of a tree entity (declared via EntityDefinition.tree): it loads
 * the whole (small) tree, every kind of it where the entity declares `tree.kind`, writes an add, a
 * move or a delete through the resource endpoints, and edits a node's record in a modal, so the tree
 * stays in view.
 */
export function EntityTreeEditor({
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
  // The tree offers what the role may do, as the list offers its New button; the engine refuses the rest.
  // A move and a delete act on one node, so they are offered per node: a role whose row is if_owner,
  // or holds a condition, may write or delete some nodes and not others.
  const user = useSessionStore((s) => s.user);
  const canCreate = hasEntityPermission(meta, user, 'create');
  const kindField = tree.kind ? meta.fields.find((f) => f.fieldname === TREE_KIND_FIELD) : undefined;

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

  const listQ = useList<Row>(entity, { page_size: 2000 });
  const rows = useMemo(() => listQ.data?.rows ?? [], [listQ.data]);
  const rowById = useMemo(() => new Map(rows.map((r) => [String(r._id), r])), [rows]);

  const nodes: TreeEditorNode[] = useMemo(
    () =>
      rows.map((r) => ({
        ...treeNodeOf(r, meta),
        kind: tree.kind ? String(r[TREE_KIND_FIELD] ?? '') : undefined,
        muted: r[TREE_ACTIVE_FIELD] === 0 || r[TREE_ACTIVE_FIELD] === false,
      })),
    [rows, meta, tree.kind],
  );
  // Every node is open until a person closes it, so a node that arrives with an add, a move or
  // another kind opens like the others.
  const expandedIds = useMemo(
    () => new Set(nodes.filter((n) => !collapsedIds?.has(n.id)).map((n) => n.id)),
    [nodes, collapsedIds],
  );

  const refetch = () => qc.invalidateQueries({ queryKey: qkPrefix.lists(entity) });
  const showError = (e: unknown) =>
    dialog.toast(e instanceof Error ? e.message : tc('ui.status.somethingWrong'), 'error');

  const removeNode = async (node: TreeEditorNode) => {
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
    try {
      await deleteDoc(entity, node.id);
      await refetch();
    } catch (e) {
      showError(e);
    }
  };

  const moveNode = async (id: string, parentId: string | null) => {
    try {
      const modified = rowById.get(id)?.modified;
      await updateDoc(entity, id, { [TREE_PARENT_FIELD]: parentId }, modified ? String(modified) : undefined);
      await refetch();
    } catch (e) {
      showError(e);
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
    <>
      <TreeEditor
        nodes={nodes}
        hasKinds={!!tree.kind}
        labels={{
          kind: kindField?.label ?? TREE_KIND_FIELD,
          newKind: tc('ui.tree.newKind'),
          kindName: tc('ui.tree.kindName'),
          create: tc('ui.action.create'),
          addRoot: tc('ui.tree.addRoot'),
          addChild: tc('ui.tree.addChild'),
          move: tc('ui.tree.move'),
          moveToRoot: tc('ui.tree.moveToRoot'),
          movingHint: tc('ui.tree.movingHint'),
          cancel: tc('ui.action.cancel'),
          delete: tc('ui.action.delete'),
          search: tc('ui.list.search'),
          noResults: tc('ui.select.noResults'),
          select: tc('ui.tree.select'),
        }}
        canCreate={canCreate}
        canMove={(node) => hasRecordPermission(meta, user, 'write', rowById.get(node.id) ?? {})}
        canDelete={(node) => hasRecordPermission(meta, user, 'delete', rowById.get(node.id) ?? {})}
        onAdd={({ parentId, kind, ancestry }) => {
          const seed: Row = {};
          if (parentId) seed[TREE_PARENT_FIELD] = parentId;
          if (kind) seed[TREE_KIND_FIELD] = kind;
          setEditing({ seed, ancestry });
        }}
        onEdit={({ id, ancestry }) => setEditing({ name: id, ancestry })}
        onMove={moveNode}
        onDelete={removeNode}
        expandedIds={expandedIds}
        onExpandedChange={setNodeExpanded}
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
    </>
  );
}
