import { TREE_ICON_FIELD, TREE_LABEL_FIELD, TREE_PARENT_FIELD, TREE_POSITION_FIELD, type EntityDefinition } from '@digitaplatform/shared';
import type { TreeViewNode } from '@digitaplatform/components';
import { recordThumbnailUrl } from '@/components/render/cells';
import { lucideIcon } from '@/lib/lucide-icon';

/** A record of a tree entity as the kit's tree draws it: its place, its icon and, where the entity
 *  names an `image_field`, its picture. The editor and the picker draw a node alike. */
export function treeNodeOf(row: Record<string, unknown>, meta: EntityDefinition | undefined): TreeViewNode {
  const parent = row[TREE_PARENT_FIELD];
  const position = row[TREE_POSITION_FIELD];
  const icon = row[TREE_ICON_FIELD];
  return {
    id: String(row._id),
    label: String(row[TREE_LABEL_FIELD] ?? row._id),
    parentId: parent != null && parent !== '' ? String(parent) : null,
    position: typeof position === 'number' ? position : undefined,
    icon: typeof icon === 'string' ? lucideIcon(icon) : undefined,
    imageUrl: (meta && recordThumbnailUrl(meta, row)) ?? undefined,
  };
}
