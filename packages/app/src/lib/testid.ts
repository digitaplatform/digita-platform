/**
 * Meta-derived test hooks for the GENERIC renderers. Every addressable thing gets a
 * canonical `data-testid` (for Playwright getByTestId + the e2e Page-Objects) AND
 * structured `data-*` dimensions (entity / field / control / page / region / action
 * / row id). The canonical id addresses one element directly; the dimensions let a
 * test slice by a single axis (e.g. every Currency field) — both for ANY app with
 * zero per-app instrumentation, and without ever selecting on labels/i18n text.
 *
 * Convention (':'-namespaced, parseable):
 *   page:<type>[:<entity>]   field:<entity>:<fieldname>   row:<id>   col:<fieldname>
 *   region:<id>              action:<name>                transition:<to>
 * Spread the result onto a JSX element: `<div {...tid.field(entity, fn, type)} />`.
 */

export type TidAttrs = Record<string, string | undefined>;

export const tid = {
  /** A page by type + optional subject entity (list/record/single/dashboard/login). */
  page: (type: string, entity?: string): TidAttrs => ({
    'data-testid': entity ? `page:${type}:${entity}` : `page:${type}`,
    'data-page': type,
    ...(entity ? { 'data-entity': entity } : {}),
  }),
  /** A field control — the per-app primitive. `control` is the FieldType. */
  field: (entity: string, fieldname: string, control: string): TidAttrs => ({
    'data-testid': `field:${entity}:${fieldname}`,
    'data-entity': entity,
    'data-field': fieldname,
    'data-control': control,
  }),
  /** The persistent link-entry input below an entry_flow grid, keyed by the
   *  parent entity + Table fieldname (e.g. entry:Order:items). */
  entry: (entity: string, fieldname: string): TidAttrs => ({
    'data-testid': `entry:${entity}:${fieldname}`,
    'data-entity': entity,
    'data-field': fieldname,
    'data-component': 'entry-input',
  }),
  /** The scan-mode input above an entry_flow grid (scan_entry), keyed like entry. */
  scan: (entity: string, fieldname: string): TidAttrs => ({
    'data-testid': `scan:${entity}:${fieldname}`,
    'data-entity': entity,
    'data-field': fieldname,
    'data-component': 'scan-input',
  }),
  /** A list row, addressable by its record id; `data-component=list-row` selects any row. */
  row: (entity: string, id: string): TidAttrs => ({
    'data-testid': `row:${id}`,
    'data-component': 'list-row',
    'data-entity': entity,
    'data-row-id': id,
  }),
  /** A list column header. */
  col: (fieldname: string): TidAttrs => ({
    'data-testid': `col:${fieldname}`,
    'data-field': fieldname,
  }),
  /** A template region (nav/topbar/main/…). */
  region: (id: string): TidAttrs => ({ 'data-testid': `region:${id}`, 'data-region': id }),
  /** A document/list action (save/cancel/submit/<custom>). */
  action: (name: string): TidAttrs => ({ 'data-testid': `action:${name}`, 'data-action': name }),
  /** A workflow state transition, keyed by its target state. */
  transition: (to: string): TidAttrs => ({ 'data-testid': `transition:${to}`, 'data-action': to }),
  /** A singleton component marker (list-table, record-form, …). */
  component: (name: string, entity?: string): TidAttrs => ({
    'data-testid': name,
    'data-component': name,
    ...(entity ? { 'data-entity': entity } : {}),
  }),
  /** A saved-view (ListPreference) control — the menu, or a per-view action keyed
   *  by the view id (apply/update/delete/default/…). */
  view: (action: string, id?: string): TidAttrs => ({
    'data-testid': id ? `view:${action}:${id}` : `view:${action}`,
    'data-action': action,
    ...(id ? { 'data-view-id': id } : {}),
  }),
};
