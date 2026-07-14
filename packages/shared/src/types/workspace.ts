/**
 * Workspace (dashboard) contract — the SINGLE source for both the engine-side seed
 * authors and the packages/ui DashboardPage. A Workspace is an ordered list of
 * presentation cards that COMPOSE the View engine (each view-bound card points at a
 * named view + section). The engine stores `cards` as opaque JSON and never
 * interprets a card kind — all interpretation is client-side, app-agnostic.
 */

export type WorkspaceCardKind = 'number' | 'chart' | 'list' | 'shortcut' | 'links';

interface WorkspaceCardBase {
  /** Unique within the workspace. */
  id: string;
  kind: WorkspaceCardKind;
  label: string;
  icon?: string;
  /** Grid span; default 1. */
  width?: 1 | 2 | 3;
  /**
   * CLIENT-side per-card behavior on empty/locked section data. Does NOT change the
   * view's section-level permission_fallback (that would blank sibling cards sharing
   * the view). Default "empty".
   */
  on_data_error?: 'empty' | 'error';
}

interface ViewBoundCard extends WorkspaceCardBase {
  /** View._id; omitted → workspace.default_view. */
  view?: string;
  /** ViewSection.key the card reads. */
  section: string;
  params?: Record<string, string | number | boolean>;
}

export interface NumberCard extends ViewBoundCard {
  kind: 'number';
  /** REQUIRED — aggregate-row key, e.g. "count" | "total". */
  value_field: string;
  format?: 'integer' | 'decimal' | 'currency' | 'percent';
  currency_field?: string;
  trend_field?: string;
  deep_link?: string;
}

export interface ChartCard extends ViewBoundCard {
  kind: 'chart';
  chart_type: 'bar' | 'line' | 'area' | 'pie' | 'donut';
  /** REQUIRED — category/x axis row key. */
  x_field: string;
  /** REQUIRED, >=1 — value series row keys. */
  y_fields: string[];
  series_field?: string;
  stacked?: boolean;
}

export interface ListCard extends ViewBoundCard {
  kind: 'list';
  columns?: string[];
  limit?: number;
  deep_link?: string;
}

export interface ShortcutCard extends WorkspaceCardBase {
  kind: 'shortcut';
  to: string;
  description?: string;
  count_view?: string;
  count_section?: string;
  count_field?: string;
}

export interface LinksCard extends WorkspaceCardBase {
  kind: 'links';
  links: Array<{ label: string; to?: string; href?: string; icon?: string }>;
}

export type WorkspaceCard = NumberCard | ChartCard | ListCard | ShortcutCard | LinksCard;

export interface WorkspaceDoc {
  _id: string;
  name: string;
  description?: string;
  module?: string;
  icon?: string;
  enabled?: boolean;
  priority?: number;
  /** Role names that may SEE this workspace. Empty/absent = all authenticated users. */
  roles?: string[];
  /** Role names for whom this is the DEFAULT workspace. */
  is_default_for_roles?: string[];
  /** View._id that view-bound cards inherit when their own `view` is omitted. */
  default_view?: string;
  cards: WorkspaceCard[];
}

/** One section's payload from the View engine (a single aggregate row, a list of
 *  rows, or null when empty/locked). */
export type ViewSectionData = Record<string, unknown> | Array<Record<string, unknown>> | null;

/** The View engine envelope the UI reads (source doc + per-section data). This
 *  is the ONLY shape a view ever returns — there is no top-level "hit" escape
 *  hatch; a consumer that needs a single pick from a single value (e.g. a
 *  Table field's `scan_entry.resolve`, see `FieldDefinition` in this package)
 *  reads it out of `sections` itself, generically, via its own config. */
export interface ViewResult {
  source: Record<string, unknown> | null;
  sections: Record<string, ViewSectionData>;
}
