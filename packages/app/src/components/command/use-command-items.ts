import type { EntitySummary } from '@/types';

/**
 * Pure command-palette item model + builder + client filter. No hooks, no
 * network — the CommandPalette host feeds in the already-loaded navigable
 * catalog (from useNavigableCatalog) + the role predicate and renders the
 * result. App-agnostic: nav items derive ONLY from meta; the few hardcoded
 * entries (Setting/BrandingSetting/account) are engine-core, inherited by
 * every app.
 */

export type CommandItemKind = 'nav-list' | 'nav-new' | 'settings' | 'account';

export interface CommandItem {
  /** Stable id, unique within the list (also the DOM id seed for aria). */
  id: string;
  kind: CommandItemKind;
  label: string;
  sublabel?: string;
  /** Extra match tokens (entity name, action verb) not shown but searchable. */
  keywords?: string;
  /** Router path to navigate to on select. */
  to: string;
  /** lucide icon name hint (the View resolves it; absent → generic). */
  icon?: string;
}

/** Curated engine-core settings entries — gated to admins by the host. */
const SETTINGS_ENTITIES: ReadonlyArray<{ name: string; label: string; icon: string }> = [
  { name: 'Setting', label: 'ui.menu.settings', icon: 'settings' },
  { name: 'BrandingSetting', label: 'ui.menu.branding', icon: 'palette' },
];

export interface BuildCommandItemsArgs {
  /** Navigable entities (from useNavigableCatalog().navigable). */
  navigable: EntitySummary[];
  /** Localized entity plural label resolver (tEntity-backed). */
  entityLabel: (entity: string, fallback?: string) => string;
  /** Chrome translator (ui.* keys) for fixed labels. */
  tc: (key: string) => string;
  /** True if the current user holds the given role (session hasRole). */
  hasRole: (role: string) => boolean;
}

/**
 * Build the full nav-item list: per navigable entity a "list" + "new" entry,
 * the admin-gated settings entries, and the always-present account entry.
 * The host applies the client substring filter (`filterCommandItems`) on top.
 */
export function buildCommandItems({
  navigable,
  entityLabel,
  tc,
  hasRole,
}: BuildCommandItemsArgs): CommandItem[] {
  const items: CommandItem[] = [];

  for (const e of navigable) {
    // label_plural is localized at the meta seam; entityLabel resolves only the singular key.
    const plural = e.label_plural ?? e.label ?? e.name;
    items.push({
      id: `nav-list:${e.name}`,
      kind: 'nav-list',
      label: plural,
      sublabel: tc('ui.cmd.openList'),
      keywords: `${e.name} ${e.module ?? ''} list`,
      to: `/${e.name}`,
      icon: e.icon,
    });
    items.push({
      id: `nav-new:${e.name}`,
      kind: 'nav-new',
      label: tc('ui.cmd.newRecord').replace('{entity}', entityLabel(e.name, e.label ?? e.name)),
      sublabel: plural,
      keywords: `${e.name} new create add`,
      to: `/${e.name}/new`,
      icon: e.icon,
    });
  }

  if (hasRole('Administrator')) {
    for (const s of SETTINGS_ENTITIES) {
      items.push({
        id: `settings:${s.name}`,
        kind: 'settings',
        label: tc(s.label),
        sublabel: tc('ui.cmd.settingsGroup'),
        keywords: `${s.name} settings configuration admin`,
        to: `/${s.name}`,
        icon: s.icon,
      });
    }
  }

  items.push({
    id: 'account',
    kind: 'account',
    label: tc('ui.menu.account'),
    sublabel: tc('ui.cmd.accountSub'),
    keywords: 'account profile password sessions me',
    to: '/account',
    icon: 'user',
  });

  return items;
}

/** Lowercased haystack for one item (label + sublabel + keywords). */
function haystack(item: CommandItem): string {
  return `${item.label} ${item.sublabel ?? ''} ${item.keywords ?? ''}`.toLowerCase();
}

/**
 * Client substring filter over the built items. Empty query → all items
 * (stable order). Otherwise: items whose haystack contains the query, with
 * exact-prefix matches (label starts with the query) ranked first, the rest
 * in their original order. Pure + stable (no locale-sensitive surprises).
 */
export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const prefix: CommandItem[] = [];
  const contains: CommandItem[] = [];
  for (const item of items) {
    if (item.label.toLowerCase().startsWith(q)) {
      prefix.push(item);
    } else if (haystack(item).includes(q)) {
      contains.push(item);
    }
  }
  return [...prefix, ...contains];
}
