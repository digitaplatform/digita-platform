import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useHost } from '@digitaplatform/plugins';
import { NavList, NavGroup, NavLeafContent, navLeafClass, Skeleton } from '@digitaplatform/components';
import { ICONS, FALLBACK_ICON } from './icons';

/**
 * UserMenu is an ordinary ERP entity. This plugin reads it through the engine's
 * GENERIC resource API and builds + role-gates the nav tree entirely itself —
 * the engine knows nothing about navigation. Menu visibility is UX only; real
 * access is enforced by the engine's per-entity permissions when a target opens.
 */

interface UserMenuRow {
  _id: string;
  kind: string;
  label: string;
  icon?: string | null;
  is_active?: boolean;
  parent?: string | null;
  tree_root?: string;
  position?: number;
  is_master?: boolean;
  priority?: number;
  roles?: { role: string }[];
  target_entity?: string | null;
  target_url?: string | null;
  filter_json?: Record<string, unknown> | null;
  requires_role?: string | null;
}

type MenuNode = UserMenuRow & { children: MenuNode[] };

interface ListResponse {
  success: boolean;
  data?: UserMenuRow[];
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface ItemContext {
  t: Translate;
  onNavigate: () => void;
}


/** Pick the tree_root the user sees: lowest-priority role match (ties → _id asc);
 *  Administrators fall back to the master tree; otherwise none. */
function pickTreeForRoles(roots: UserMenuRow[], roleSet: Set<string>): UserMenuRow | undefined {
  const matches = roots.filter((r) => (r.roles ?? []).some((rr) => roleSet.has(String(rr.role))));
  matches.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a._id.localeCompare(b._id));
  if (matches.length > 0) return matches[0];
  if (roleSet.has('Administrator')) return roots.find((r) => r.is_master);
  return undefined;
}

/** Build the nested, role-pruned tree from flat rows. Drops requires_role nodes
 *  the user lacks (+ their subtree) and empty groups; sorts by position, label. */
function resolveTree(rows: UserMenuRow[], roles: string[]): MenuNode[] {
  const roleSet = new Set(roles);
  const active = rows.filter((r) => r.is_active !== false);
  const picked = pickTreeForRoles(
    active.filter((r) => r.kind === 'tree_root'),
    roleSet,
  );
  if (!picked) return [];

  const byParent = new Map<string, UserMenuRow[]>();
  for (const r of active) {
    if (r.tree_root !== picked._id || r.kind === 'tree_root') continue;
    const key = r.parent ?? '';
    const list = byParent.get(key);
    if (list) list.push(r);
    else byParent.set(key, [r]);
  }

  const build = (parentId: string): MenuNode[] => {
    const children = (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.label.localeCompare(b.label));
    const isAdmin = roleSet.has('Administrator');
    const out: MenuNode[] = [];
    for (const row of children) {
      // Administrators bypass node-level gates (consistent with the tree-pick
      // fallback + the engine's platform-wide Administrator bypass).
      if (row.requires_role && !roleSet.has(row.requires_role) && !isAdmin) continue;
      const sub = build(row._id);
      if (row.kind === 'group' && sub.length === 0) continue;
      out.push({ ...row, children: sub });
    }
    return out;
  };

  return build(picked._id);
}

function labelFor(node: MenuNode, t: Translate): string {
  const key = `user_menu.${node._id}.label`;
  const hit = t(key);
  return hit && hit !== key ? hit : node.label;
}

function NodeIcon({ name }: { name?: string | null }) {
  const Icon = (name && ICONS[name]) || FALLBACK_ICON;
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

/**
 * Target URL for an entity node: the doctype is the path param (host route
 * /:entity), and any pre-applied list filter travels as a `filter` query param
 * (JSON). Parameters live in the URL — the contract between any nav source and
 * the host's pages — so the generic ListPage reads them via useParams() +
 * useSearchParams() with zero plugin↔page coupling.
 */
function entityTarget(node: MenuNode): string {
  const base = `/${node.target_entity}`;
  if (node.filter_json && Object.keys(node.filter_json).length > 0) {
    return `${base}?filter=${encodeURIComponent(JSON.stringify(node.filter_json))}`;
  }
  return base;
}


function Group({
  node,
  depth,
  ctx,
  open,
  onToggle,
}: {
  node: MenuNode;
  depth: number;
  ctx: ItemContext;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <NavGroup
      label={labelFor(node, ctx.t)}
      icon={<NodeIcon name={node.icon} />}
      open={open}
      onToggle={onToggle}
    >
      {open && node.children.length > 0 && (
        <MenuList nodes={node.children} depth={depth + 1} ctx={ctx} />
      )}
    </NavGroup>
  );
}

function MenuItem({
  node,
  depth,
  ctx,
  open,
  onToggle,
}: {
  node: MenuNode;
  depth: number;
  ctx: ItemContext;
  open: boolean;
  onToggle: () => void;
}) {
  switch (node.kind) {
    case 'group':
      return <Group node={node} depth={depth} ctx={ctx} open={open} onToggle={onToggle} />;

    case 'entity':
      if (!node.target_entity) return null;
      return (
        <li>
          <NavLink
            to={entityTarget(node)}
            data-ui="nav-leaf"
            onClick={ctx.onNavigate}
            className={({ isActive }) => navLeafClass(isActive)}
          >
            <NavLeafContent icon={<NodeIcon name={node.icon} />}>{labelFor(node, ctx.t)}</NavLeafContent>
          </NavLink>
        </li>
      );

    case 'url':
      if (!node.target_url) return null;
      return (
        <li>
          <NavLink
            to={node.target_url}
            data-ui="nav-leaf"
            onClick={ctx.onNavigate}
            className={({ isActive }) => navLeafClass(isActive)}
          >
            <NavLeafContent icon={<NodeIcon name={node.icon} />}>{labelFor(node, ctx.t)}</NavLeafContent>
          </NavLink>
        </li>
      );

    case 'external_link':
      if (!node.target_url) return null;
      return (
        <li>
          <a
            href={node.target_url}
            target="_blank"
            rel="noopener noreferrer"
            data-ui="nav-leaf"
            className={navLeafClass(false)}
          >
            <NavLeafContent
              icon={<NodeIcon name={node.icon} />}
              trailing={<ExternalLink className="h-3.5 w-3.5 shrink-0 text-textMuted" aria-hidden="true" />}
            >
              {labelFor(node, ctx.t)}
            </NavLeafContent>
          </a>
        </li>
      );

    case 'divider':
      return (
        <li>
          <hr className="my-2 border-border" />
        </li>
      );

    default:
      return null;
  }
}

/**
 * Sibling accordion: at every level only ONE group is open at a time, and all
 * start collapsed — a click on another group closes the previous one. Keeps the
 * rail calm (you see the top sections, not 60 flat links). State is in-memory and
 * survives navigation because the host mounts this rail once.
 */
function MenuList({ nodes, depth, ctx }: { nodes: MenuNode[]; depth: number; ctx: ItemContext }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <NavList sub={depth > 0}>
      {nodes.map((node) => (
        <MenuItem
          key={node._id}
          node={node}
          depth={depth}
          ctx={ctx}
          open={openId === node._id}
          onToggle={() => setOpenId((cur) => (cur === node._id ? null : node._id))}
        />
      ))}
    </NavList>
  );
}

/**
 * The navigation rail plugin. Reads the UserMenu entity via the generic resource
 * API, resolves the role-scoped tree client-side, and renders it as collapsible
 * groups + links wired to the host's router. Host services (api / getUser / t /
 * closeMobileNav) arrive via useHost().
 */
export function UserMenuNav() {
  const { api, getUser, t, closeMobileNav } = useHost();
  const [tree, setTree] = useState<MenuNode[] | null>(null);
  // Load failures never surface the raw backend error (e.g. a permission
  // string) to the user — D3 requires the nav to always render a clean,
  // non-alarming state. A failed load degrades to the same empty-tree
  // fallback as a role with zero visible nodes; this flag only exists to
  // short-circuit straight to that fallback without waiting on `tree`.
  const [failed, setFailed] = useState(false);

  // Roles are snapshotted at mount. That's correct here: the host gates the shell
  // behind auth, so (re)login unmounts + remounts this plugin with current roles.
  // If an in-place session/role refresh is ever added, make roles reactive (read
  // them from a host subscription) and include them in the dep array.
  useEffect(() => {
    let cancelled = false;
    const roles = getUser()?.roles ?? [];
    api
      .get<ListResponse>('/api/v1/resource/UserMenu', {
        filters: JSON.stringify([['is_active', '=', true]]),
        page_size: 5000,
      })
      .then((res) => {
        if (!cancelled) setTree(resolveTree(res.data ?? [], roles));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, getUser]);

  if (failed || (tree && tree.length === 0)) {
    return <p className="p-4 text-sm text-textMuted">No navigation assigned.</p>;
  }
  if (!tree) {
    return (
      <div className="flex flex-col gap-2 p-3" role="status" aria-label="Loading navigation">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-md" />
        ))}
      </div>
    );
  }

  const ctx: ItemContext = { t, onNavigate: closeMobileNav };
  return (
    <nav data-ui="nav" className="p-3" aria-label="Main navigation">
      <MenuList nodes={tree} depth={0} ctx={ctx} />
    </nav>
  );
}
