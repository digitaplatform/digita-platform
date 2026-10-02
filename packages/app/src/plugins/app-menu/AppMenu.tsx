import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useHost } from '@digitaplatform/plugins';
import { NavGroup, NavLeafContent, NavList, Skeleton, navLeafClass } from '@digitaplatform/components';
import { useMetaCatalog } from '@/hooks/useMeta';
import { useList } from '@/hooks/useList';
import { lucideIcon } from '@/lib/lucide-icon';
import { buildAppMenu, type MenuNode } from './menu-tree';

function Leaf({ node, onNavigate }: { node: MenuNode; onNavigate: () => void }) {
  const icon = lucideIcon(node.icon);
  if (node.target?.kind === 'external') {
    return (
      <li>
        <a href={node.target.href} target="_blank" rel="noopener noreferrer" data-ui="nav-leaf" className={navLeafClass(false)}>
          <NavLeafContent icon={icon} trailing={<ExternalLink className="h-3.5 w-3.5 shrink-0 text-textMuted" aria-hidden="true" />}>
            {node.label}
          </NavLeafContent>
        </a>
      </li>
    );
  }
  return (
    <li>
      <NavLink to={node.target!.to} data-ui="nav-leaf" onClick={onNavigate} className={({ isActive }) => navLeafClass(isActive)}>
        <NavLeafContent icon={icon}>{node.label}</NavLeafContent>
      </NavLink>
    </li>
  );
}

/** A group inside a section: one open at a time per level, all closed at first, so the rail stays calm. */
function Entries({ nodes, sub, onNavigate }: { nodes: MenuNode[]; sub: boolean; onNavigate: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <NavList sub={sub}>
      {nodes.map((node) =>
        node.children.length > 0 ? (
          <NavGroup
            key={node.id}
            label={node.label}
            icon={lucideIcon(node.icon)}
            open={openId === node.id}
            onToggle={() => setOpenId((cur) => (cur === node.id ? null : node.id))}
          >
            <Entries nodes={node.children} sub onNavigate={onNavigate} />
          </NavGroup>
        ) : (
          <Leaf key={node.id} node={node} onNavigate={onNavigate} />
        ),
      )}
    </NavList>
  );
}

/**
 * The app's left menu: the entity that declares `tree.menu: "app"`, drawn from the kit's rail parts.
 * A top-level node with children is a section, its heading above its entries; an app without such an
 * entity draws nothing.
 */
export function AppMenu() {
  const { t, closeMobileNav } = useHost();
  const catalog = useMetaCatalog();
  const entity = catalog.data?.find((e) => e.tree?.menu === 'app')?.name;
  const listQ = useList(entity, { page_size: 2000 });
  const menu = useMemo(() => buildAppMenu(listQ.data?.rows ?? []), [listQ.data]);

  if (catalog.isLoading || (entity && listQ.isLoading)) {
    return (
      <div className="flex flex-col gap-2 p-3" role="status" aria-label={t('ui.appMenu.loading')}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (catalog.isError || listQ.isError) return <p className="p-4 text-sm text-textMuted">{t('ui.appMenu.loadFailed')}</p>;
  if (!entity) return null;
  if (menu.length === 0) return <p className="p-4 text-sm text-textMuted">{t('ui.appMenu.empty')}</p>;

  return (
    <nav data-ui="nav" className="space-y-4 p-3" aria-label={t('ui.appMenu.label')}>
      {menu.map((node) =>
        node.children.length > 0 ? (
          <section key={node.id} aria-labelledby={`app-menu-${node.id}`}>
            <h2 id={`app-menu-${node.id}`} className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-textMuted">
              {lucideIcon(node.icon, 14)}
              {node.label}
            </h2>
            <Entries nodes={node.children} sub={false} onNavigate={closeMobileNav} />
          </section>
        ) : (
          <NavList key={node.id}>
            <Leaf node={node} onNavigate={closeMobileNav} />
          </NavList>
        ),
      )}
    </nav>
  );
}
