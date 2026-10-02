import type { EntityDefinition, FieldDefinition, IndexDefinition, TreeConfig } from "./types/entity.js";

/** The fields of the tree block every reader names: a node's parent, its label and its place among its siblings. */
export const TREE_PARENT_FIELD = "parent";
export const TREE_LABEL_FIELD = "label";
export const TREE_POSITION_FIELD = "position";
/** The column that partitions an entity with `tree.kind` into trees of one kind each. */
export const TREE_KIND_FIELD = "kind";
/** The field of an app menu that names the roles a node shows to; the block makes it the `role_visibility_field`. */
export const TREE_MENU_ROLES_FIELD = "roles";

/** How deep a node may lie where `tree.max_depth` names no depth. */
export const TREE_MAX_DEPTH_DEFAULT = 8;

const field = (definition: Partial<FieldDefinition> & Pick<FieldDefinition, "fieldname" | "fieldtype" | "label">): FieldDefinition =>
  definition as FieldDefinition;

/**
 * The fields the tree block brings to `entity`: the node's own, `kind` where `tree.kind` asks for
 * it, and those the renderer of `tree.menu` reads. An app adds its own fields beside them.
 */
export function treeBlockFields(entity: Pick<EntityDefinition, "name" | "tree">): FieldDefinition[] {
  const tree = entity.tree ?? {};
  const fields = [
    field({ fieldname: TREE_LABEL_FIELD, fieldtype: "Data", label: "Label", required: true, translatable: true }),
    field({ fieldname: TREE_PARENT_FIELD, fieldtype: "Link", label: "Parent", target: entity.name }),
    field({ fieldname: TREE_POSITION_FIELD, fieldtype: "Int", label: "Position" }),
    field({ fieldname: "icon", fieldtype: "Data", label: "Icon" }),
    field({ fieldname: "active", fieldtype: "Check", label: "Active", default: 1 }),
  ];
  if (tree.kind) fields.push(field({ fieldname: TREE_KIND_FIELD, fieldtype: "Data", label: "Kind", required: true }));
  if (tree.menu === "app") {
    fields.push(
      field({ fieldname: "target_entity", fieldtype: "Data", label: "Target entity" }),
      field({ fieldname: "target_url", fieldtype: "Data", label: "Target URL" }),
      field({ fieldname: "filter_json", fieldtype: "JSON", label: "Filter" }),
      field({ fieldname: TREE_MENU_ROLES_FIELD, fieldtype: "JSON", label: "Roles" }),
    );
  }
  if (tree.menu === "website") {
    fields.push(
      field({ fieldname: "site", fieldtype: "Link", label: "Site", target: "WebSite", required: true }),
      field({ fieldname: "location", fieldtype: "Select", label: "Location", options: ["header", "footer", "family"], required: true }),
      field({ fieldname: "page", fieldtype: "Link", label: "Page", target: "WebPage" }),
      field({ fieldname: "href", fieldtype: "Data", label: "Link" }),
    );
  }
  return fields;
}

/** The indexes the tree block brings: a node's children, its subtree, and with `tree.kind` its kind's tree. */
export function treeBlockIndexes(tree: TreeConfig): IndexDefinition[] {
  const indexes: IndexDefinition[] = [
    { fields: [TREE_PARENT_FIELD], name: "idx_tree_parent" },
    { fields: ["_ancestors"], name: "idx_tree_ancestors" },
  ];
  if (tree.kind) indexes.push({ fields: [TREE_KIND_FIELD], name: "idx_tree_kind" });
  return indexes;
}

/** The keys that make a field the block's own: a field under a block field's name must match them. */
export const TREE_BLOCK_SHAPE_KEYS = ["fieldtype", "target", "options", "required"] as const;
