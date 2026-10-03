import { TREE_ACTIVE_FIELD, TREE_ICON_FIELD, TREE_LABEL_FIELD, TREE_PARENT_FIELD, TREE_POSITION_FIELD } from '@digitaplatform/shared';

type Row = Record<string, unknown>;

/** Where an entry leads: a list of the app, a path of the app, or an address outside it. */
export type MenuTarget = { kind: 'path'; to: string } | { kind: 'external'; href: string };

export interface MenuNode {
  id: string;
  label: string;
  icon?: string;
  target?: MenuTarget;
  children: MenuNode[];
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

function targetOf(row: Row): MenuTarget | undefined {
  const entity = text(row.target_entity);
  if (entity) {
    const filter = row.filter_json;
    const json = typeof filter === 'string' ? text(filter) : filter && Object.keys(filter).length > 0 ? JSON.stringify(filter) : undefined;
    return { kind: 'path', to: json ? `/${entity}?filter=${encodeURIComponent(json)}` : `/${entity}` };
  }
  const url = text(row.target_url);
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? { kind: 'external', href: url } : { kind: 'path', to: url.startsWith('/') ? url : `/${url}` };
}

const order = (a: Row, b: Row) =>
  (Number(a[TREE_POSITION_FIELD] ?? 0) - Number(b[TREE_POSITION_FIELD] ?? 0)) ||
  String(a[TREE_LABEL_FIELD] ?? '').localeCompare(String(b[TREE_LABEL_FIELD] ?? ''));

/**
 * The menu the rows of the app's menu entity draw. The engine answers only the nodes a person's roles
 * meet. A node is drawn only when its parent is drawn and it is switched on; a node with children is
 * a section, and one without children and without a target is left out.
 */
export function buildAppMenu(rows: Row[]): MenuNode[] {
  const byParent = new Map<string, Row[]>();
  for (const row of rows) {
    // Readable defaults are explicit; masked eligibility fields cannot establish a visible node.
    if (!Object.hasOwn(row, TREE_PARENT_FIELD) || !Object.hasOwn(row, TREE_ACTIVE_FIELD)
      || row[TREE_ACTIVE_FIELD] === 0 || row[TREE_ACTIVE_FIELD] === false) continue;
    const key = text(row[TREE_PARENT_FIELD]) ?? '';
    byParent.set(key, [...(byParent.get(key) ?? []), row]);
  }
  const build = (parentId: string, seen: Set<string>): MenuNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort(order)
      .flatMap((row) => {
        const id = String(row._id);
        if (seen.has(id)) return [];
        const children = build(id, new Set(seen).add(id));
        const target = targetOf(row);
        if (children.length === 0 && !target) return [];
        return [{ id, label: String(row[TREE_LABEL_FIELD] ?? id), icon: text(row[TREE_ICON_FIELD]), target, children }];
      });
  return build('', new Set());
}
