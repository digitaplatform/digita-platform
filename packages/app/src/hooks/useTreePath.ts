import { TREE_PARENT_FIELD } from '@digitaplatform/shared';
import { useEffect, useMemo, useState } from 'react';
import type { TreeConfig } from '@digitaplatform/shared';
import { useList } from '@/hooks/useList';

/**
 * The labels of a tree node and of its ancestors, root first: undefined until the topmost one is
 * loaded. The engine has no endpoint for a node's ancestors, and a form must not load the whole
 * tree for one field, so the path comes from the target's list one level at a time: a request
 * names the ids found so far (`_id in`), and the topmost row's parent field names the next id.
 * A parent the list does not return, deleted or hidden from the person, ends the path, as the
 * tree picker then shows its child as a root.
 */
export function useTreePath(
  entity: string | undefined,
  tree: TreeConfig | undefined,
  labelField: string,
  nodeId: string,
): { labels?: string[]; error: unknown } {
  const [chain, setChain] = useState<{ nodeId: string; ids: string[] }>({ nodeId: '', ids: [] });
  // The ids found for another node name nothing of this one's path.
  const ids = useMemo(() => (chain.nodeId === nodeId ? chain.ids : [nodeId]), [chain, nodeId]);
  const parentField = tree ? TREE_PARENT_FIELD : '';
  const list = useList(tree && nodeId ? entity : undefined, {
    filters: [['_id', 'in', ids]],
    fields: [parentField, labelField],
    page_size: ids.length,
  });

  let labels: string[] | undefined;
  let nextId: string | undefined;
  // Rows kept from the previous request name the path of fewer ids, or of another node.
  if (tree && nodeId && list.data && !list.isPlaceholderData) {
    const byId = new Map(list.data.rows.map((r) => [String(r._id), r]));
    const found: string[] = [];
    const seen = new Set<string>();
    for (let id: string | null = nodeId; id && !seen.has(id); ) {
      seen.add(id);
      const row = byId.get(id);
      if (!row) {
        if (!ids.includes(id)) nextId = id;
        break;
      }
      found.unshift(String(row[labelField] ?? row._id));
      const parent = row[parentField];
      id = parent != null && parent !== '' ? String(parent) : null;
    }
    if (!nextId) labels = found;
  }

  useEffect(() => {
    if (nextId) setChain({ nodeId, ids: [...ids, nextId] });
  }, [nextId, nodeId, ids]);

  return { labels, error: list.error };
}
