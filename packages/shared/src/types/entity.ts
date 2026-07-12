import type { EntityPermission } from "./permissions.js";

// ─── Naming ──────────────────────────────────────────────

/**
 * How a new document's `_id` is produced.
 *
 * `system` is the recommended default for user-facing entity data: the engine
 * assigns a native MongoDB ObjectId — system-controlled, unique by construction,
 * never typed by a user. The human-facing identifier lives in a separate
 * `business_key` field (see EntityDefinition.business_key). The other strategies
 * produce string `_id`s and remain for reference/lookup tables and legacy entities.
 */
export type NamingStrategy =
  | "auto_increment"
  | "uuid"
  | "by_field"
  | "expression"
  | "user_set"
  | "system";

export interface NamingConfig {
  strategy: NamingStrategy;
  prefix?: string;
  pad_length?: number;
  expression?: string;
  field?: string;
}

// ─── Field Types ─────────────────────────────────────────

/**
 * Storage / UI contract of each built-in field type.
 *
 * Most entries map to familiar primitives. Three are less obvious and worth
 * calling out:
 *
 * `Link`         Single FK to another entity. Stored as the target's `_id`
 *                  (string). Validated at save time; delete-protection lives
 *                  in the platform.
 *
 * `Tag`          Loose multi-value field, stored as `string[]` in Mongo.
 *                  The platform does NOT validate the entries against any
 *                  target entity — it is intentionally a bag of free-form
 *                  tokens. If you need referential integrity, use a child
 *                  Table with a Link column instead.
 */
export type FieldType =
  | "Data"
  | "Text"
  | "SmallText"
  | "TextEditor"
  | "Code"
  | "Markdown"
  | "Int"
  | "Float"
  | "Currency"
  | "Percent"
  | "Check"
  | "Date"
  | "Datetime"
  | "Time"
  | "Duration"
  | "Select"
  | "Link"
  | "Table"
  | "Attach"
  | "AttachImage"
  | "Image"
  | "Password"
  | "JSON"
  | "Geolocation"
  | "Signature"
  | "Rating"
  | "Barcode"
  | "Color"
  | "Tag"
  | "Phone"
  | "ReadOnly"
  | "SectionBreak"
  | "ColumnBreak"
  | "TabBreak"
  | "Heading"
  | "HTML"
  | "Button";

export const LAYOUT_FIELD_TYPES: readonly FieldType[] = [
  "SectionBreak",
  "ColumnBreak",
  "TabBreak",
  "Heading",
  "HTML",
  "Button",
] as const;

export const NON_STORED_FIELD_TYPES: readonly FieldType[] = [
  ...LAYOUT_FIELD_TYPES,
  "ReadOnly",
] as const;

/**
 * Canonical fieldname for stable per-row identity inside a `Table` field.
 * Auto-injected by `BaseDocument.addChild` when missing. Opaque to users;
 * used by sub-row Links (`target_path`), per-row references, and
 * row-aware delete-protection.
 */
export const ROW_ID_FIELD = "_row_id";

// ─── Field Definition ────────────────────────────────────

/**
 * One priority-ordered rule in `ScanResolveConfig.try`: which View section to
 * read, and how to map that section's first row onto a scan hit. A view
 * section is an array of rows, a single aggregate row, or null/absent (see
 * `ViewSectionData`); the row tried here is always its first entry.
 */
export interface ScanResolveRule {
  /** Section key to read from the resolve view's response (`ViewResult.sections`). */
  section: string;
  /** Row field that becomes the hit's picked id (fed into `add_via_link`). */
  link: string;
  /** Hit-fields key → row field, read from this rule's row when it wins. */
  fields?: Record<string, string>;
  /** Hit-fields key → constant literal, applied when this rule wins (alongside `fields`). */
  set?: Record<string, unknown>;
  /** Row field that becomes the hit's optional display label. */
  label?: string;
}

/**
 * Declarative recipe (app-declared, on a Table field's `scan_entry`) for
 * turning a scanned code into a hit — the generic scan control never knows
 * any section or field name itself. Calls `view` with the scanned code, then
 * tries each rule in `try` in order against the response's `sections`; the
 * FIRST rule whose section carries a row wins. An absent/empty picked id (or
 * no rule matching) means "not found".
 */
export interface ScanResolveConfig {
  /** View to call with the scanned code. */
  view: string;
  /** Query param name the scanned code is passed as (default `"code"`). */
  param?: string;
  /** Priority-ordered rules; the first whose section has a row wins. */
  try: ScanResolveRule[];
}

export interface FieldDefinition {
  fieldname: string;
  fieldtype: FieldType;
  label: string;

  // Link-specific
  target?: string;
  target_display?: string;
  target_search?: string[];
  target_filters?: Record<string, unknown>;
  /**
   * On `Link`: when set, the link points at a row INSIDE a
   * Table field on the target doc, not at the target doc itself.
   *
   * `target_path` names the Table field on the target entity. The stored
   * value is then a composite `"<parent_id>::<row_id>"` string, where
   * `row_id` is the row's stable `_row_id`. The resolver locates the parent
   * by `parent_id`, then finds the row with that `_row_id` inside the named
   * Table.
   *
   * Example: a child row could store a `Link → parent` with
   * `target_path: "rows"` — pointing at one row in `parent.rows[]`.
   * The pattern itself is generic: any parent-with-Table → row reference.
   */
  target_path?: string;
  /**
   * On `Link`: open a full-screen search modal (SearchDialog) instead of the
   * inline typeahead dropdown — for pickers that need more context per row,
   * or that live in a clipped container such as a grid cell. The dropdown
   * stays the default; opt in per field.
   */
  search_dialog?: boolean;
  /**
   * Columns shown in the `search_dialog` (also the fields the link-search
   * endpoint returns per row). Defaults to the target entity's `search_fields`.
   * Each entry must be a field on the target entity; labels come from its meta.
   */
  search_columns?: string[];
  /** On a `search_dialog` Link: show the inline search button. Default true;
   *  false makes the field a pure type-and-Enter/Tab input (no button). */
  search_button?: boolean;
  /** On a `search_dialog` Link: minimum query length before Enter/Tab opens the
   *  dialog. Default 1. */
  search_min_chars?: number;
  /**
   * On `Link`: name of a declarative View rendered as a side context panel
   * whenever the field carries a value — the picked id is passed as the
   * view's `id` param. Pure metadata: the generic record page renders the
   * panel, the app only declares WHICH view (e.g. a linked entity → a summary
   * view with related aggregates / recent items).
   */
  context_view?: string;
  /** Optional panel title for `context_view` (i18n key or plain text);
   *  defaults to the field label. */
  context_title?: string;

  // Select-specific
  options?: string[] | string;
  /** Resolve options from a built-in dynamic source (e.g. "timezones",
   *  "currencies") instead of a static `options` list — app-agnostic, resolved
   *  client-side. Takes precedence over `options` when set. */
  options_source?: string;

  // Table-specific
  child_fields?: FieldDefinition[];
  max_rows?: number;
  min_rows?: number;
  cannot_add_rows?: boolean;
  cannot_delete_rows?: boolean;

  // Per-Table snapshot manifests — applied per row at docstatus 0→1.
  // See top-level `EntityDefinition.snapshot` for the same semantics.
  snapshot?: SnapshotManifest[];

  /**
   * Per-Link freeze directive — applied at docstatus 0→1.
   *
   * Set on Link fields (including child Link fields inside a
   * Table). At the submit moment the platform reads the target entity's
   * `snapshot_fields` declaration (or the override list given here) and
   * writes a JSON sub-object `<fieldname>_snapshot` next to the link
   * carrying the frozen values. The frozen sub-object stays read-only after
   * docstatus=1.
   *
   * For sub-row Links (`target_path` set), the entire row is frozen as
   * JSON regardless of the target's `snapshot_fields` — addresses,
   * line-items-of-other-docs, and similar opaque structures need full
   * preservation.
   *
   * Forms:
   *   freeze: true             — copy the target's declared `snapshot_fields`.
   *   freeze: [...]            — override list. Copy exactly these field names.
   *   freeze: false            — explicit opt-out. Used to satisfy the boot-time
   *                              coverage lint when the link is purely an
   *                              identifier and carries no display data.
   *   freeze: { ...FreezeSpec } — object form. Same JSON snapshot as `true`,
   *                              plus a declarative `flatten[]` directive
   *                              that mirrors selected snapshot values into
   *                              flat columns for list views / standard
   *                              filters / indexes. Replaces the old
   *                              "field + manifest entry" pair.
   *
   * The JSON snapshot at `<fieldname>_snapshot` is always written. The
   * `flatten[]` mirroring is additive — it never removes the JSON.
   */
  freeze?: boolean | string[] | FreezeSpec;

  /**
   * Compound uniqueness constraints WITHIN this Table field's rows.
   * Each entry is a list of child fieldnames whose combination must be
   * unique across all rows. Example:
   *
   *   "row_unique": [["purpose", "is_default"]]
   *
   * → at most one row may have any given `(purpose, is_default)` pair.
   *
   * Validated by `validateRowUniqueness` after the existing per-row
   * field validation. Empty / null / undefined values participate normally.
   */
  row_unique?: string[][];

  // Validation
  required?: boolean;
  unique?: boolean;
  max_length?: number;
  min_length?: number;
  min_value?: number;
  max_value?: number;
  regex?: string;
  regex_message?: string;
  precision?: number;
  non_negative?: boolean;

  // Default
  default?: unknown;

  // Conditional logic
  depends_on?: string;
  mandatory_depends_on?: string;
  read_only_depends_on?: string;
  /** Cosmetic, client-only formula (`eval:...`) shown read-only in a grid cell.
   *  Evaluated over the row; never persisted and ignored by the server. */
  display_formula?: string;
  /** Cosmetic, client-only conditional styling for a grid cell. The first rule whose
   *  `when` expression (`eval:...`, evaluated over the row) is truthy applies `class`. */
  conditional_style?: { when: string; class: string }[];
  /** Grid footer (Table field only): map a grid column to a parent field shown as a
   *  total in a footer row. The value is read from the parent doc and formatted as the
   *  given fieldtype (default Currency). */
  footer?: { column: string; field: string; fieldtype?: FieldType; currency_field?: string }[];
  /** Grid stepper affordance for a numeric cell (−/+ buttons), clamped to `min`. */
  stepper?: { min?: number; step?: number };
  /** Table field: the exact grid columns (child fieldnames), in display order.
   *  Omitted → every non-layout child field shows in declaration order. */
  grid_columns?: string[];
  /** Table field: rows are added ONLY by picking from this child Link field's
   *  search dialog (no empty rows). The add control opens that picker; a pick
   *  appends a row with the link set + field defaults. Disables auto-append. */
  add_via_link?: string;
  /** Table field: edit a row in a modal detail dialog; the grid cells are then
   *  display-only (no inline editing). */
  row_detail_dialog?: boolean;
  /** Table field presentation (Nordstern F14): 'cards' forces the detail-dialog
   *  presentation, 'grid' forces the inline grid, 'auto' (default) = grid, or
   *  detail-dialog when row_detail_dialog is set. */
  presentation?: 'grid' | 'cards' | 'auto';
  /** Table field: the editable child fields shown in the `row_detail_dialog`
   *  (in order). Omitted → all editable child fields. */
  detail_fields?: string[];
  /** Table field: inline keyboard entry flow. On each cell commit (Enter / Tab /
   *  link pick) focus advances through `sequence`; after the last column a new row
   *  is appended and the first column focused. `rules` override the next column
   *  conditionally — `when` is an `eval:` expression over `row`. */
  entry_flow?: {
    sequence: string[];
    rules?: { after: string; when: string; goto: string }[];
    /** Field values seeded onto a row when it is created via the entry flow (only
     *  where the row does not already carry the field). */
    defaults?: Record<string, unknown>;
  };
  /**
   * Table field (with `entry_flow`): name of a declarative View rendered as a
   * compact context strip under the grid while a line is being entered —
   * e.g. availability / last price / valuation for the row being entered.
   */
  entry_context_view?: string;
  /**
   * Param mapping for `entry_context_view`: view param → row field, or
   * `"$doc.<headerfield>"` to read from the parent document (same token
   * semantics as `target_filters`). Params mapping to empty values are
   * omitted; the strip only fetches once its required params are present.
   */
  entry_context_params?: Record<string, string>;
  /**
   * Table field (with `entry_flow`): render a scan-mode input above the grid
   * and tell the generic control both how to RESOLVE a scanned code into a
   * hit and how to APPLY that hit to a row — no scan-specific field or
   * section names are hardcoded anywhere in the platform; everything here is
   * app-declared.
   *   `resolve`        — how to turn a scanned code into a hit (see
   *                       `ScanResolveConfig`). Without it the scan input has
   *                       nothing to call and never resolves anything.
   *   `match_on`       — row fields that together identify a duplicate line
   *                       (typically the `add_via_link` field plus any
   *                       `field_map`-mapped fields). A repeated scan whose
   *                       hit matches an existing row increments
   *                       `quantity_field` instead of adding a duplicate
   *                       (supermarket semantics).
   *   `quantity_field` — row field that receives the scan multiplier.
   *   `field_map`      — hit `fields` key → row field, applied when a row is
   *                       seeded or merged.
   * Any part left undeclared degrades gracefully (a plain add, no merge) —
   * the control never crashes on incomplete config.
   */
  scan_entry?: {
    resolve?: ScanResolveConfig;
    match_on: string[];
    quantity_field: string;
    field_map?: Record<string, string>;
  };

  // Fetch from linked doc
  fetch_from?: string;
  fetch_if_empty?: boolean;

  // UI display
  hidden?: boolean;
  read_only?: boolean;
  /**
   * Marks an EDITABLE field whose value the server also derives from other
   * fields (a compute rule writes it). Meaningful inside a Table's
   * `child_fields`, where a read-only derived cell (`read_only: true`) is always
   * refreshed from the compute-preview, but an editable one is not.
   *
   * With `recompute: true` the client compute-preview keeps this editable field
   * in sync with the server's recomputed value whenever its inputs change —
   * instead of freezing at the last value merely because the cell is non-empty.
   * A value the user types DIRECTLY into the field is treated as an explicit
   * override and preserved (the preview no longer refreshes it for that row).
   *
   * Leave unset for a pure input field the server only backfills when empty
   * (e.g. a default / fetch_from target): those must never be overwritten once
   * they hold a user entry.
   */
  recompute?: boolean;
  bold?: boolean;
  description?: string;
  placeholder?: string;
  width?: string;
  /**
   * Form-grid span override (of a 12-track section) for the dense single-column
   * layout — overrides the intrinsic per-fieldtype span. `xs`/`sm` → narrow (4),
   * `md` → half (6), `lg`/`full` → the full row (12). `width` above stays for
   * list/print column sizing (read by the datagrid), NOT the form.
   */
  span?: 'xs' | 'sm' | 'md' | 'lg' | 'full';

  // List view
  in_list_view?: boolean;
  in_standard_filter?: boolean;
  in_global_search?: boolean;

  // Print
  print_hide?: boolean;
  print_width?: string;

  // Permission level
  perm_level?: number;

  // Copy behavior
  no_copy?: boolean;
  set_only_once?: boolean;
  /**
   * This field may still change while docstatus=1 (system-maintained counters,
   * settlement status, post-submit annotations). Enforced by
   * `DocStatusEngine.validateSubmittedPatch` — every field WITHOUT this flag stays
   * frozen after submit. Legal on top-level fields and on Table `child_fields`
   * (per-cell scoping — a flagged child cell may be patched per row via
   * `SubmittedPatch.children[]`). Must NOT co-occur with: an active `freeze`,
   * a snapshot-manifest target, a freeze `flatten[].as` name, `set_only_once`,
   * a system field, or Attach/AttachImage (v1 — refcount cleanup is not wired on
   * the post-submit path). The boot lint (`entity-registry.validateAllowOnSubmit`)
   * strips violations with a warning.
   */
  allow_on_submit?: boolean;

  // Translation
  translatable?: boolean;

  // Section/Tab specific
  collapsible?: boolean;
  collapsed?: boolean;

  // Attach / AttachImage specific
  /**
   * Opt attachments uploaded against this field into PUBLIC (anonymous) read.
   * Default (absent/false) → files are `is_private` and served only through the
   * authenticated download route. When `true`, an upload to this field is stored
   * non-private and its `file_url` points at the generic public file route
   * (`/public/file/:id`), so it renders for unauthenticated visitors — e.g. the
   * login-screen logo/background, or public website media. Generic: any entity
   * field may opt in; the engine never special-cases a specific entity.
   */
  public?: boolean;

  // Currency specific
  currency_field?: string;

  // Duration specific
  hide_days?: boolean;
  hide_seconds?: boolean;

  // Sort order
  idx?: number;
}

// ─── Snapshot Manifest ───────────────────────────────────

/**
 * Snapshot directive: at the docstatus 0→1 transition, the SnapshotResolver
 * embeds declared fields from a Link target into hand-declared
 * read-only fields on the parent doc. Once docstatus=1 fires, the existing
 * freeze locks the snapshot. Used to produce legally-correct self-contained
 * documents that don't drift when their referenced live data changes.
 *
 * `from`     — name of a Link field on the parent.
 * `fields`   — { <targetFieldOnParent>: <sourcePathOnLinkedDoc> }. The source
 *              path is dotted; the target field MUST be declared on the parent
 *              (or, for per-Table snapshots, on the child_fields list).
 *
 * Each target field MUST have `read_only: true` and MUST NOT also declare
 * `fetch_from`. Boot-time validation logs warnings and disables the manifest
 * for the offending entity.
 */
export interface SnapshotManifest {
  from: string;
  fields: Record<string, string>;
}

/**
 * One mirror of a snapshot value into a flat column on the parent doc.
 *
 * `from`     — dotted path on the linked doc (or sub-row, for `target_path`
 *              freezes). Resolved from the same source object that the
 *              JSON `<fieldname>_snapshot` is built from.
 * `as`       — flat field name written to the parent doc. Conventionally
 *              suffixed `_at_<doctype>` (e.g. `source_name_at_doc`)
 *              so it's clear at a glance the value is frozen.
 *
 * The other keys are field-shape hints used by the entity-registry to
 * auto-generate a `FieldDefinition` if `as` isn't already declared. They
 * mirror the corresponding `FieldDefinition` properties — see those for
 * semantics.
 */
export interface FlattenSpec {
  from: string;
  as: string;
  label?: string;
  fieldtype?: FieldType;
  in_list_view?: boolean;
  in_standard_filter?: boolean;
  bold?: boolean;
  /**
   * Pre-submit population. The auto-generated field receives a
   * `fetch_from` declaration so its value is filled from the linked doc
   * during insert/save (before docstatus 0→1). Useful for fields
   * referenced by the naming series, list views, or any pre-submit
   * surface — the flatten freeze later overwrites the value with the
   * authoritative snapshot at submit time. The two are not in conflict:
   * fetch_from is the live preview, the flatten freeze is the legal
   * record.
   *
   * Defaulted to dotted path `<linkFieldname>.<from>` when this flag is
   * `true`. A string value sets a custom path.
   */
  fetch_from?: string | true;
  /** Pair with `fetch_from`: only fetch when the field is empty. */
  fetch_if_empty?: boolean;
  /**
   * Auto-create a single-field index on `as`. The index is named
   * `idx_${as}` and goes into `entity.indexes[]` so the schema
   * migrator picks it up alongside hand-declared indexes.
   */
  indexed?: boolean;
  /** Free-form description copied to the generated field. */
  description?: string;
}

/**
 * Object form of a Link's `freeze` directive. Equivalent to `freeze: true`
 * for the JSON snapshot, plus optional `flatten[]` mirrors and an explicit
 * field override list.
 */
export interface FreezeSpec {
  /**
   * Override list for the JSON snapshot at `<fieldname>_snapshot`. Same
   * semantics as the old `freeze: string[]` shorthand. If omitted, the
   * resolver reads the target entity's `snapshot_fields` (same as
   * `freeze: true`).
   */
  fields?: string[];
  /** Flat-column mirrors of selected snapshot values. */
  flatten?: FlattenSpec[];
}

// ─── Time-Series Collection Config ───────────────────────

/**
 * Native MongoDB time-series collection support (Mongo 5.0+).
 *
 * When set, the engine creates the entity's collection as a time-series
 * collection. Time-series collections are append-optimised: documents are
 * INSERT-ONLY apart from limited modifications to the meta field. The
 * platform enforces this at the application layer too — `update()` rejects
 * patches that touch any field other than `meta_field`.
 *
 * Fit:
 *   ✓ append-only ledgers, audit trails, sensor / metric streams,
 *     event histories — anything whose rows are written once.
 *   ✗ entities that mutate after insert (status transitions, line edits,
 *     re-submits) — Mongo time-series rejects such updates by design.
 *
 * Boot rules:
 *   `is_submittable` must be false
 *   `track_changes` must be false (a time-series doc is never updated)
 *   cannot coexist with `period_check`
 *   `time_field` must reference an existing `Date` / `Datetime` field
 *   `meta_field` (if set) must reference an existing `Data` / `Link` field
 */
export interface TimeSeriesConfig {
  time_field: string;
  meta_field?: string;
  granularity?: "seconds" | "minutes" | "hours";
  expire_after_seconds?: number;
}

// ─── Period Close ────────────────────────────────────────

/**
 * Block writes against documents whose effective date falls into a closed
 * accounting / reporting / fiscal period.
 *
 * The mechanism is fully generic — the platform doesn't ship any specific
 * period model. Apps declare their own period entity (must have at least
 * `is_closed: Check`, `start_date: Date`, `end_date: Date` fields) and
 * point `period_entity` at it.
 *
 * Two lookup strategies:
 *   Direct: when `period_field` is set, the document holds a Link to the
 *     period and the validator reads `is_closed` straight from it.
 *   By date: otherwise, the validator finds the period whose
 *     `start_date <= date_value <= end_date` matches the document's date.
 *     Useful when the period is implicit (every transaction has a posting
 *     date but no explicit period link).
 *
 * Cascade: if the period belongs to a parent that has a period entity of its
 * own (e.g. a fiscal year), the validator follows the link via
 * `period_field` declared on the period entity itself. Any parent
 * `is_closed: true` short-circuits to a closed result.
 */
export interface PeriodCheckConfig {
  /** Date / Datetime field on this entity used to locate the period. */
  date_field: string;
  /** Entity that holds period definitions (e.g. "period"). */
  period_entity: string;
  /**
   * Optional Link field on this entity that points at the period directly.
   * If absent, the period is found by date-range scan on `period_entity`.
   */
  period_field?: string;
  /**
   * Lifecycle phases that must reject writes when the period is closed.
   * Default: `["submit"]` — accounting docs typically want to allow drafting
   * inside a closed period for amendment workflows but never submit.
   * `"cancel"` (added #23) prevents reversing posted docs after
   * the period closes — typical accounting policy.
   * `"post_submit_update"` gates `updateSubmitted()` patches (settlement
   * counters etc.) INDEPENDENTLY of `"update"` — an entity can seal
   * settlements in a closed period without also blocking draft edits.
   */
  block_on?: ("insert" | "update" | "submit" | "cancel" | "post_submit_update")[];
}

// ─── Post-Submit Patch (updateSubmitted) ─────────────────

/**
 * The ONLY legal mutation shape for a submitted (docstatus=1) document.
 * Consumed by `DocumentService.updateSubmitted`; gated field-by-field by
 * `allow_on_submit` via `DocStatusEngine.validateSubmittedPatch`.
 */
export interface SubmittedPatch {
  /** Absolute assignments to `allow_on_submit` top-level fields. */
  set?: Record<string, unknown>;
  /**
   * Transactional read-modify-write deltas on NUMERIC `allow_on_submit`
   * fields. Resolved against the in-transaction (session-loaded) value so a
   * `withTransaction` retry recomputes correctly.
   */
  increment?: Record<string, number>;
  /**
   * Per-row child-table patches, addressed by the row's stable `_row_id`
   * (guaranteed by `ensureRowIds` — every persisted row has one). Cell fields
   * must carry `allow_on_submit` on the Table's `child_fields` (or the Table
   * field itself must be flagged, admitting whole-row edits). Adding or removing
   * rows is NOT expressible — only patching existing rows.
   */
  children?: Array<{
    /** Table fieldname on the entity. */
    table: string;
    /** `_row_id` of the target row. */
    row_id: string;
    set?: Record<string, unknown>;
    increment?: Record<string, number>;
  }>;
}

// ─── Index Definition ────────────────────────────────────

export interface IndexDefinition {
  fields: string[];
  name: string;
  unique?: boolean;
  type?: "text" | "2dsphere";
  sparse?: boolean;
  expireAfterSeconds?: number;
}

// ─── Action Definition ───────────────────────────────────

/**
 * A single user-settable input of a job-capable action. Declared on the action
 * so the jobs UI can render a form (and the value rides on the job's `params`,
 * reaching the hook via `services.actionParams`). Purely declarative — the
 * engine passes params through untouched; INTERNAL chunk plumbing like
 * `_cursor` is NOT declared here and never surfaces to the user.
 */
export interface ActionParamDef {
  /** Param key as the hook reads it from `actionParams` (e.g. "dry_run"). */
  name: string;
  label: string;
  type: "boolean" | "int" | "string" | "select";
  /** Prefilled value; the UI seeds the form field with it. */
  default?: boolean | number | string;
  /** Option values for `type: "select"`. */
  options?: string[];
  /** Bounds for `type: "int"` (the UI clamps; the hook should re-clamp). */
  min?: number;
  max?: number;
  description?: string;
}

export interface ActionDefinition {
  label: string;
  action: string;
  type?: "primary" | "default" | "danger";
  /** Icon name resolved client-side to a lucide icon (see the UI icon registry).
   *  Unknown/absent → label-only button. */
  icon?: string;
  /** Require a confirm dialog before running (skipped when opens_dialog — the
   *  dialog is itself the confirmation). */
  confirm?: boolean;
  show_if?: string;
  requires_permission?: string;
  opens_dialog?: boolean;
  dialog_fields?: FieldDefinition[];
  /**
   * Job-capable action: implements the chunk protocol (returns
   * `ActionChunkResult`, resumes via the `_cursor` param — see types/jobs.ts)
   * and may run long. The digita-jobs orchestrator only accepts actions
   * carrying this flag; the UI lists them in its job catalog.
   */
  long_running?: boolean;
  /**
   * User-settable inputs for a `long_running` action, rendered by the jobs
   * UI as a param form. Omit for actions that take no configuration.
   */
  params?: ActionParamDef[];
}

// ─── Report Link ─────────────────────────────────────────

/**
 * Metadata-driven print button: links a digita-report definition to this
 * entity. The UI renders a Print action per link (permission- and
 * show_if-filtered) and opens the embedded report preview; params are
 * resolved from the CURRENT document via `param_map`.
 */
export interface EntityReportLink {
  /** Report definition name (e.g. "monthly-summary"). */
  report: string;
  /** Button/menu label; falls back to the report name. */
  label?: string;
  /** report param name -> doc field path (e.g. { param: "field_path" }). */
  param_map?: Record<string, string>;
  /** Offered export formats (default ["pdf"]); "html" powers the preview. */
  formats?: ("pdf" | "html" | "png" | "csv")[];
  /** Permission gate on THIS entity (default "print"). */
  requires_permission?: string;
  /** eval: expression on the doc (same contract as action show_if). */
  show_if?: string;
  /** Primary print action of the entity (rendered as the main button). */
  primary?: boolean;
}

// ─── Link Definition ─────────────────────────────────────

export interface LinkDefinition {
  label: string;
  entity: string;
  link_field: string;
  icon?: string;
  show_count?: boolean;
  filters?: Record<string, unknown>;
}

// ─── State Definition ────────────────────────────────────

/**
 * Per-state permission override applied IN ADDITION to the base entity
 * permissions. The override is the AND of base ⨯ override — a state may
 * STRIP permissions but not grant them. Use a `0` to deny in the named
 * state; absence of a key leaves the base permission intact.
 *
 * Example:
 *   state "Approved" with `permissions: [{ role: "Editor", write: 0 }]`
 *   → Editor can write the doc in any state EXCEPT Approved.
 */
export interface StatePermissionOverride {
  role: string;
  read?: 0 | 1;
  write?: 0 | 1;
  submit?: 0 | 1;
  cancel?: 0 | 1;
  delete?: 0 | 1;
}

export interface StateDefinition {
  value: string;
  color: string;
  indicator?: string;
  /** Marks the state stamped onto new documents when no status is given. */
  is_initial?: boolean;
  /** Marks states with no outgoing transitions (validators warn at boot). */
  is_terminal?: boolean;
  /** Optional pin to the docstatus axis. Boot-time validator warns when
   *  divergence happens. The two axes (status / docstatus) coexist. */
  doc_status?: 0 | 1 | 2;
  /**
   * Marks THIS state as the one a generic docstatus flip (submit → 1 / cancel → 2)
   * lands in, when several states share the same `doc_status`. Required to
   * disambiguate — e.g. two terminal states at doc_status 2 (`expired`, `cancelled`):
   * flag `cancelled` so `cancel()` is unambiguous instead of picking by declaration
   * order. When exactly one state (or exactly one non-terminal state) carries a
   * doc_status, no flag is needed; otherwise the engine fails loud.
   */
  docstatus_default?: boolean;
  /** Per-role permission deltas applied in this state (AND with base). */
  permissions?: StatePermissionOverride[];
}

/**
 * Workflow transition declaration. The platform enforces at `update`:
 *   the (from → to) pair is declared
 *   `allowed_roles` matches at least one of the user's roles (admin bypasses)
 *   the `condition` expression evaluates true under `evaluateExpression`
 *
 * On success the engine applies `side_effects.set` to the doc, then fires
 * `on_workflow_transition:<from>:<to>` through the rule engine inside the
 * same transaction so rules can chain side-effects (create child docs,
 * stamp audit fields, notify, etc.).
 *
 * `from: "*"` is a wildcard — useful for transitions like Cancel that
 * should be reachable from any state.
 */
export interface TransitionDefinition {
  from: string;
  to: string;
  /** UI button label / action key. */
  action?: string;
  /** ExpressionEvaluator string evaluated against `{ doc, user }`. */
  condition?: string;
  /** Roles permitted to perform this transition. Administrator bypasses. */
  allowed_roles: string[];
  /** Field stamps applied to the doc as part of this transition. */
  side_effects?: { set?: Record<string, unknown> };
}

// ─── Hook Definitions ────────────────────────────────────

export interface HookDefinitions {
  validate?: string;
  before_insert?: string;
  after_insert?: string;
  before_save?: string;
  on_update?: string;
  before_submit?: string;
  on_submit?: string;
  /**
   * Fires INSIDE the `updateSubmitted` transaction, after the patch is applied
   * in memory and validated, BEFORE the write. Guard invariants here (e.g.
   * `invoiced_quantity <= quantity`). May `doc.set` ONLY `allow_on_submit`
   * fields — the closing band guardrail aborts the tx otherwise.
   */
  before_submitted_update?: string;
  /** Fires after the `updateSubmitted` write, same transaction. */
  on_submitted_update?: string;
  before_cancel?: string;
  on_cancel?: string;
  before_delete?: string;
  after_delete?: string;
  on_change?: string;
  on_field_change?: Record<string, string>;
  computed?: Record<string, string>;
  /**
   * Action handlers — one entry per `actions[].action` name. The action
   * router (POST /resource/:doctype/:name/action/:action_name) looks up
   * the handler here and invokes it. Handler signature:
   *   (doc, ctx?, services?) => Promise<unknown>
   * The returned value is sent back to the FE inside ApiResponse.data.
   */
  actions?: Record<string, string>;
  has_permission?: string;
  on_list_load?: string;
}

// ─── Entity Definition (top-level) ───────────────────────

/**
 * Logical database target.
 *
 * Three names are reserved by the platform and have dedicated env-var mappings:
 *   "identity" — auth subjects, sessions, tokens      → MONGODB_IDENTITY_DB
 *   "logs"     — append-only telemetry, audit         → MONGODB_LOGS_DB
 *   "core"     — platform/registry/system collections → MONGODB_CORE_DB
 *
 * Any other string is an *application database* physical Mongo DB name is
 * derived from `${MONGODB_APP_DB_PREFIX}_<target>` (with `-` normalised to
 * `_`). This lets a vertical declare its own domain databases — `master`,
 * `accounting`, `sales`, `purchase`, `app`, … — without per-DB env vars.
 *
 * The literal union below keeps editor autocomplete useful for the common
 * choices while still accepting any string.
 */
export type DatabaseTarget =
  | "identity"
  | "logs"
  | "audits"
  | "core"
  | "app"
  | (string & { __brand?: "AppDatabase" });

/**
 * Marks a self-referential tree entity (any category / folder / hierarchy)
 * so the UI can render a generic tree picker (for Link fields targeting it) and a
 * tree-editor view, with no hardcoded entity or field names in the engine/UI.
 */
export interface TreeConfig {
  /** Self-referencing Link field pointing at the parent node (e.g. "parent"). */
  parent_field: string;
  /** Field shown as the node label. Defaults to the entity's `title_field`. */
  label_field?: string;
  /**
   * Optional discriminator that partitions the entity into independent trees
   * (e.g. a node's `domain` field → one separate tree per partition). A picker
   * scoped to one value shows only that partition's tree.
   */
  group_by?: string;
  /** Field used to sort siblings. Defaults to `label_field`. */
  order_field?: string;
}

/**
 * Per-entity steering of the operator UI's AUTO-LAYOUT engine. Pure UI metadata:
 * the engine stores and serves it verbatim (meta passthrough) and never acts on
 * it. An authored `TabBreak`/`ColumnBreak` in `fields[]` makes this whole block
 * irrelevant — a fully-authored layout always wins over the auto engine.
 */
export interface FormLayoutConfig {
  /**
   * "auto"   (default) — tab the form when it is large enough (see `tabify`)
   *                      AND has ≥2 SectionBreaks; otherwise a single page.
   * "tabbed" — always promote sections to tabs (a no-op with <2 sections).
   * "flat"   — never auto-tab; sections stay stacked cards on one page.
   */
  layout?: "auto" | "tabbed" | "flat";
  /** Data-field count at/above which "auto" tabs the form. Default 16. */
  tabify?: number;
  /**
   * Sections with fewer data fields than this merge into the previous tab
   * instead of becoming their own tab. Default 3 (1 = never merge).
   */
  min_tab_fields?: number;
  /**
   * Density cap of the responsive field grid on large screens. Default 3.
   *   3 — intrinsic spans as-is (4/6/12 → up to 3 fields per row)
   *   2 — narrow fields widen to half rows (span 4 → 6; up to 2 per row)
   *   1 — classic stacked form (every field span 12)
   * A per-field `span` override still wins over the cap where explicitly set.
   */
  columns?: 1 | 2 | 3;
}

export interface EntityDefinition {
  // Identity
  name: string;
  module: string;
  label?: string;
  label_plural?: string;
  description?: string;
  icon?: string;
  color?: string;

  /**
   * Optional steering of the UI auto-layout engine (see {@link FormLayoutConfig}).
   * Ignored when `fields[]` authors an explicit TabBreak/ColumnBreak layout.
   */
  form?: FormLayoutConfig;

  // Database routing (required — every entity must declare its target database)
  database: DatabaseTarget;

  /**
   * Storage folder for files uploaded against this entity's Attach /
   * AttachImage fields. Upload keys become `<storage_path>/<uuid><ext>`
   * (e.g. `"avatars"` → `avatars/3f2a….png` in the object store).
   *
   * REQUIRED for any entity that declares Attach/AttachImage fields
   * (top-level or inside Table child_fields) — the engine refuses to boot
   * otherwise, and uploads are rejected with 400 when the target entity
   * has no storage_path. There is deliberately NO default folder and NO
   * bucket-root fallback.
   *
   * Format: lowercase alphanumerics / dash / underscore, optionally ONE
   * nesting level with `/` (e.g. `"media/avatars"`). No leading/trailing
   * slash, no `..`.
   */
  storage_path?: string;

  // Naming
  naming: NamingConfig;

  /**
   * Field name(s) forming this entity's human-facing business key (e.g. a
   * serial number, reference code, or similar). Unique per entity, user-facing and
   * searchable — distinct from `_id`, which is the system-assigned internal key (an
   * ObjectId under `system` naming). Seeds and references resolve a target by this
   * key instead of its `_id`; the engine hardcodes no field name.
   */
  business_key?: string | string[];

  /**
   * For documents whose human identifier is a generated number: the naming
   * expression (e.g. "DOC-{####:year_label}") used to populate the
   * `business_key` field on insert. `_id` stays a system ObjectId; the number
   * lives in the business_key field, generated from the same sequence the old
   * `_id` expression used, so numbering continuity holds. See docs/ID-CONCEPT.md.
   */
  business_key_series?: string;

  // Behavior flags
  is_submittable?: boolean;
  is_child?: boolean;
  is_single?: boolean;
  is_virtual?: boolean;
  is_log?: boolean;
  /** Frontend hint: after a successful write of this entity, the operator UI
   *  re-applies the /boot-derived state (branding/default_workspace) without a full
   *  re-bootstrap — e.g. Setting / BrandingSetting. The engine does not act on it. */
  reload_boot_on_write?: boolean;
  /** Name of a `string[]` field holding role names that gate VISIBILITY of each
   *  document: a row whose field is empty/absent is visible to everyone, otherwise
   *  it is visible only to users whose roles intersect it. The engine enforces this
   *  on list/read (defense-in-depth; Administrator bypasses). Generic — any entity
   *  may opt in (e.g. Workspace → "roles"). */
  role_visibility_field?: string;

  // Change tracking
  track_changes?: boolean;
  track_views?: boolean;

  // Search & display
  search_fields?: string[];
  title_field?: string;
  image_field?: string;
  default_sort?: { field: string; order: "asc" | "desc" };

  // List view
  in_global_search?: boolean;

  // Quick entry
  allow_quick_entry?: boolean;
  quick_entry_fields?: string[];

  // Import/export
  allow_import?: boolean;
  allow_export?: boolean;

  // Timeline — `timeline_field` (singular) is the field whose value the
  // status-resolver looks at to pick a state color from `states[]`.
  timeline_field?: string;

  // Core definitions
  fields: FieldDefinition[];
  permissions: EntityPermission[];
  hooks?: HookDefinitions;
  indexes?: IndexDefinition[];
  actions?: ActionDefinition[];
  links?: LinkDefinition[];
  /** Metadata-driven print buttons (digita-report definitions). */
  reports?: EntityReportLink[];
  states?: StateDefinition[];

  // Snapshot manifests — applied at docstatus 0→1. See `SnapshotManifest`.
  snapshot?: SnapshotManifest[];

  /**
   * Master-side declaration of which fields must be frozen by consumers
   * referencing this entity via a Link with `freeze: true`. The single
   * source of truth for "what about me belongs on a printed legal document".
   *
   * Example:
   *   "snapshot_fields": ["display_name", "reference_code", "email"]
   *
   * Operational fields like `internal_notes`, `computed_totals` belong NOT
   * in this list — they are neither legally relevant nor stable.
   *
   * For sub-row Links (`target_path`) the entire row is frozen instead;
   * `snapshot_fields` is ignored in that case.
   */
  snapshot_fields?: string[];

  /** Native MongoDB time-series collection. See `TimeSeriesConfig`. */
  time_series?: TimeSeriesConfig;

  /** Period-close enforcement. See `PeriodCheckConfig`. */
  period_check?: PeriodCheckConfig;

  /** Self-referential tree config — enables the generic tree picker + editor. See `TreeConfig`. */
  tree?: TreeConfig;

  /** Workflow transition list. See `TransitionDefinition`. */
  transitions?: TransitionDefinition[];

  /** Field that holds the workflow state. Defaults to `"status"`. */
  workflow_field?: string;
}
