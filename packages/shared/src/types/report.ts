/**
 * Report definition contract (digita-report).
 *
 * A report definition is a JSON document (stored in MongoDB by digita-report)
 * describing a band-based, paginated document layout over tenant data.
 * digita-report prepares the definition with data into an absolutely
 * positioned page model and exports it via one renderer (HTML → PDF).
 *
 * All geometry is in millimetres (mm); font sizes and border widths are in
 * points (pt). Expressions use the platform's safe jsep-allowlist evaluator
 * (no eval / new Function); text content interpolates `{expr}` placeholders
 * (`{{` / `}}` escape literal braces).
 */

/** Bump when the definition shape changes incompatibly. */
export const REPORT_SCHEMA_VERSION = 2;

/**
 * CSS reference pixel: 96dpi ⇒ 1mm = 96/25.4 px. The single source of truth for
 * every mm↔px conversion on both sides of the wire — the designer canvas, the
 * PNG exporter's backing-store estimate, and the schema's page-dimension cap.
 */
export const PX_PER_MM = 96 / 25.4;

/**
 * Band vocabulary v1 (bandorientierter Aufbau):
 * - report-title    — once, at the start of the first page
 * - page-header     — top of every page (after the title on page 1)
 * - group-header    — when the group key changes
 * - data            — once per row of its bound collection (top-level:
 *                     binding.collection names an entry of data.collections;
 *                     each top-level data band is an independent section with its
 *                     own groups, row cap and aggregate scope); may nest child
 *                     `bands` bound to an embedded path or a lookup (master-detail)
 * - group-footer    — when the group closes (aggregates over the group)
 * - report-summary  — once, after the last row
 * - page-footer     — reserved at the bottom of every page
 */
export type BandType =
  | "report-title"
  | "page-header"
  | "group-header"
  | "data"
  | "group-footer"
  | "page-footer"
  | "report-summary";

export type ReportObjectType =
  | "text"
  | "image"
  | "line"
  | "rect"
  | "barcode"
  | "checkbox"
  | "table"
  | "matrix"
  | "gauge";

/**
 * Diagonal watermark stamped behind the content of every page (e.g. "DRAFT",
 * "COPY"). Rendered pointer-events-none and BEHIND all objects.
 */
export interface ReportWatermark {
  text: string;
  /** 0..1 stamp opacity. Default 0.08. */
  opacity?: number;
  /** Rotation in degrees. Default -30. */
  angle?: number;
  /** Font size in pt. Default 72. */
  font_size?: number;
  /** CSS color. Default "#000". */
  color?: string;
}

export interface ReportPageSetup {
  width_mm: number;
  height_mm: number;
  margins_mm: { top: number; right: number; bottom: number; left: number };
  /** Optional diagonal watermark stamped behind every page's content. */
  watermark?: ReportWatermark;
}

export interface ReportObjectStyle {
  font_family?: string;
  font_size_pt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** CSS color for text. */
  color?: string;
  /** CSS color for the object background. */
  background?: string;
  border?: {
    width_pt: number;
    color: string;
    /** Omitted = all four sides. */
    sides?: ("top" | "right" | "bottom" | "left")[];
  };
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  padding_mm?: number;
  /** Multiplier, like CSS unitless line-height. */
  line_height?: number;
}

export interface ReportFormatSpec {
  type: "number" | "currency" | "date" | "datetime" | "percent" | "boolean";
  /** ISO 4217, e.g. "EUR" — required rendering input for type "currency". */
  currency?: string;
  decimals?: number;
  date_style?: "short" | "medium" | "long";
}

export interface ReportObjectBase {
  id: string;
  type: ReportObjectType;
  /** Position relative to the parent band's top-left, in mm. */
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  style?: ReportObjectStyle;
}

export interface TextObject extends ReportObjectBase {
  type: "text";
  /** Template string; `{expr}` interpolates, `{{`/`}}` escape braces. */
  content: string;
  /** Applied when the content is a single `{expr}` resolving to a value. */
  format?: ReportFormatSpec;
  /**
   * Grow the object (and its band instance) vertically when the resolved
   * text wraps beyond h_mm instead of clipping; objects below shift down.
   */
  can_grow?: boolean;
}

export interface ImageObject extends ReportObjectBase {
  type: "image";
  /** Static source (URL or data URI). */
  src?: string;
  /** Expression yielding the source at render time (wins over `src`). */
  binding?: string;
}

export interface LineObject extends ReportObjectBase {
  type: "line";
  /** Default: horizontal when w_mm >= h_mm, else vertical. */
  direction?: "horizontal" | "vertical";
}

export interface RectObject extends ReportObjectBase {
  type: "rect";
  radius_mm?: number;
  /** Shape variant; "ellipse" ignores radius_mm. Default rectangle. */
  shape?: "rectangle" | "ellipse";
}

export interface BarcodeObject extends ReportObjectBase {
  type: "barcode";
  /** bwip-js symbology id, e.g. "code128", "qrcode", "ean13". */
  symbology: string;
  /** Expression yielding the encoded value. */
  value: string;
  show_text?: boolean;
}

export interface CheckboxObject extends ReportObjectBase {
  type: "checkbox";
  /** Expression; truthy renders checked. */
  binding: string;
}

export interface TableCell {
  /** Template string; `{expr}` interpolates (same rules as text objects). */
  content: string;
  /** Applied when the content is a single `{expr}` resolving to a value. */
  format?: ReportFormatSpec;
  style?: ReportObjectStyle;
  colspan?: number;
  rowspan?: number;
}

export interface TableRow {
  height_mm: number;
  cells: TableCell[];
}

/**
 * Excel-like static grid (FastReport "Table"): own columns/rows, per-cell
 * templates, formats, styles and spans. For repeating data rows use a data
 * band — the table object is for fixed layouts (totals blocks, info boxes,
 * multi-column headers).
 */
export interface TableObject extends ReportObjectBase {
  type: "table";
  /** Column widths in mm (cells beyond the column count are ignored). */
  columns_mm: number[];
  rows: TableRow[];
  /** Grid line around every cell; omit for borderless. */
  cell_border?: { width_pt: number; color: string };
}

/**
 * Pivot / cross table (FastReport "Matrix"): one row dimension × one
 * optional column dimension × one aggregate, computed over ALL data rows of
 * the report query (report scope; group-scoped matrices are a later step).
 * Row/column keys are discovered at render time and sorted alphabetically;
 * the object renders into its box and clips (size it in the designer).
 */
export interface MatrixObject extends ReportObjectBase {
  type: "matrix";
  /** Dot path of the row dimension (e.g. "group_label"). */
  row_by: string;
  /** Dot path of the column dimension; omitted = single value column. */
  col_by?: string;
  value: {
    fn: "sum" | "count" | "avg" | "min" | "max";
    /** Dot path of the aggregated value; required for every fn except count. */
    path?: string;
    format?: ReportFormatSpec;
  };
  /** Width of the row-label column. */
  row_header_w_mm: number;
  /** Width of every value column. */
  col_w_mm: number;
  /** Height of every matrix row. */
  row_h_mm: number;
  /** Append row/column totals + grand total. */
  show_totals?: boolean;
  header_style?: ReportObjectStyle;
  cell_style?: ReportObjectStyle;
  total_style?: ReportObjectStyle;
  /**
   * Feeding collection (multi-collection). Wins over structural resolution;
   * REQUIRED when the matrix sits in report-title / page-header / page-footer,
   * which have no data-band collection scope.
   */
  collection?: string;
}

/**
 * Gauge (FastReport Radial/Linear/Simple): visualizes ONE numeric value on
 * a min…max scale — radial (semicircle) or linear (bar). The value is an
 * expression evaluated in the band context.
 */
export interface GaugeObject extends ReportObjectBase {
  type: "gauge";
  kind: "radial" | "linear";
  /** Expression yielding the numeric value (e.g. "SUM('amount')"). */
  value: string;
  min?: number;
  max?: number;
  /** Optional target marker on the scale. */
  target?: number;
  /** Label formatting (shown when show_value, default true). */
  format?: ReportFormatSpec;
  show_value?: boolean;
  /** Fill/track CSS colors. */
  color?: string;
  track_color?: string;
}

export type ReportObject =
  | TextObject
  | ImageObject
  | LineObject
  | RectObject
  | BarcodeObject
  | CheckboxObject
  | TableObject
  | MatrixObject
  | GaugeObject;

/**
 * Referenced master-detail: fetch the detail rows of the CURRENT row from
 * another collection (engine links are plain string ids, so this is an
 * equality join: detail.foreign_field == row.local_field).
 */
export interface ReportLookup {
  /** Logical database of the detail collection (e.g. "app"). */
  database: string;
  collection: string;
  /** Dot path on the current row whose value is matched (e.g. "_id"). */
  local_field: string;
  /** Field on the detail collection (e.g. "parent_ref"). */
  foreign_field: string;
  filters?: ReportFilterTuple[];
  sort?: { field: string; dir: 1 | -1 }[];
  /** Per-parent-row cap (default 500). */
  limit?: number;
}

export interface ReportBand {
  id: string;
  type: BandType;
  height_mm: number;
  objects: ReportObject[];
  /**
   * group-header/group-footer bands: which group level this band belongs to
   * (0 = the first entry in `groups`). Default 0.
   */
  group_level?: number;
  /**
   * Data bands only — exactly ONE of three flavors:
   * - `collection`: TOP-LEVEL data bands only; names a key of data.collections
   *   and iterates that collection. Each such band is an INDEPENDENT SECTION with
   *   its own groups, aggregate scope and truncation warning.
   * - `path`: an embedded array of the current row (e.g. "lines"); the band
   *   repeats per element with `row` = element, `doc` = root document (nested only).
   * - `lookup`: referenced rows from another collection; the band repeats per
   *   detail document with `row` = detail doc, `doc` = root document (nested only).
   * `collection` is REQUIRED on top-level data bands and FORBIDDEN on nested ones.
   */
  binding?: { collection?: string; path?: string; lookup?: ReportLookup };
  /**
   * group-header / group-footer: REQUIRED — id of the top-level data band (section)
   * this band groups for. report-summary: optional — absent = static chrome at the
   * document end (no aggregate/row context).
   */
  section?: string;
  /** Top-level data bands only: group levels for THIS section (max 3). */
  groups?: ReportGroup[];
  /** Data bands only: nested detail bands (data bands with path/lookup binding). */
  bands?: ReportBand[];
}

export interface ReportParam {
  name: string;
  /**
   * "list" resolves to an array — the only param type usable as the value of
   * an `in` filter (a scalar param there is a render-time 400). A supplied
   * comma-separated string or an actual array both coerce to `string[]`.
   */
  type: "string" | "number" | "date" | "boolean" | "list";
  label?: string;
  required?: boolean;
  default?: string | number | boolean | string[];
}

/**
 * Declarative filter tuple `[field, op, value]` — the engine's list-filter
 * vocabulary. Ops v1: "=", "!=", ">", ">=", "<", "<=", "in", "like".
 * String values may reference query params as `{param}` placeholders.
 */
export type ReportFilterTuple = [string, string, unknown];

/** One equality pair of a multi-field join: parent.local_field == joined.foreign_field. */
export interface ReportJoinOn {
  local_field: string;
  foreign_field: string;
}

/**
 * Row-level join (MongoDB $lookup): every parent row gains the matching
 * documents of another collection at `row.<as>` — a Row[] (or Row|null when
 * `single`). SAME database only: $lookup cannot cross databases, so a join
 * target in another database is rejected at validation; cross-database
 * master-detail uses a nested lookup band instead.
 */
export interface ReportJoin {
  /** Joined docs land at row.<as>; identifier, unique per collection, never "_id". */
  as: string;
  /** Joined collection (same database as the parent collection by construction). */
  collection: string;
  /**
   * Optional; when present it MUST equal the parent collection's database —
   * any other value is rejected loudly at validation (never silently ignored
   * as an unknown key). Cross-database joins are not supported.
   */
  database?: string;
  /** Simple equality join: parent.local_field == joined.foreign_field. */
  local_field?: string;
  foreign_field?: string;
  /** Multi-field equality join (every pair must match). Exclusive with local_field/foreign_field. */
  on?: ReportJoinOn[];
  /** Extra conditions on the joined docs ({param} placeholders allowed). */
  filters?: ReportFilterTuple[];
  sort?: { field: string; dir: 1 | -1 }[];
  /** Per-parent-row cap on joined docs (default 100, max 5000). */
  limit?: number;
  /** true → row.<as> is the FIRST match or null, not an array. */
  single?: boolean;
}

/**
 * One named collection a report reads from. The key under
 * ReportDataConfig.collections is the name a top-level data band references via
 * binding.collection. Each entry has its OWN filters/sort/row cap — sections over
 * different collections are fully independent.
 */
export interface ReportCollection {
  /**
   * Logical database target like an entity's `database` field (e.g. "app");
   * digita-report composes the physical per-tenant DB name with the engine's
   * db-names rule.
   */
  database: string;
  /** Collection name = entity name (PascalCase singular), e.g. "Widget". */
  collection: string;
  /** Values may reference report params as `{param}` placeholders. */
  filters?: ReportFilterTuple[];
  sort?: { field: string; dir: 1 | -1 }[];
  /** Per-collection row cap; exceeding it emits a truncation warning. */
  limit?: number;
  /**
   * Row-level joins: each entry attaches matching docs of another collection
   * at `row.<as>` — Row[] (or Row|null when `single`). SAME database only.
   */
  joins?: ReportJoin[];
}

export interface ReportDataConfig {
  /**
   * Named collections the report reads from (≥1). Keys are identifiers
   * ([a-zA-Z_][a-zA-Z0-9_]*); every top-level data band binds one via
   * binding.collection. Multiple collections = independent sections.
   */
  collections: Record<string, ReportCollection>;
  /** Report-global query parameters, shared by every collection's filters. */
  params?: ReportParam[];
}

export interface ReportGroup {
  /** Dot path of the grouping key on the root row (up to 3 nested levels). */
  by: string;
}

export interface ReportDefinition {
  /** Unique key (identifier, [a-z0-9-]); definitions are addressed by name. */
  name: string;
  title: string;
  description?: string;
  /** Categorization tags (kebab-case, up to 8) — filter chips in the list UI. */
  tags?: string[];
  /**
   * App affiliation for report-list grouping (e.g. "erp"). Optional explicit
   * mark that OVERRIDES the derived affiliation; unset = derived from the
   * collections' logical databases (the prefix before the first "_", the
   * engine's `<app>_<domain>` convention: "erp_sales" → "erp") — see
   * `reportApps()` in report-apps.ts.
   */
  app?: string;
  /**
   * Saved sample values for `data.params` (demo business keys) — the preview
   * falls back to them so a fresh open renders without typing parameters.
   */
  sample_params?: Record<string, unknown>;
  schema_version: number;
  /** BCP-47 locale driving Intl formatting; falls back to "en". */
  locale?: string;
  /**
   * Per-language chrome-text overlay (localization). Keyed by BCP-47 tag (or its
   * primary subtag, e.g. "de"), then by OBJECT ID — the stable WYSIWYG address. When
   * a report renders in locale L, a text object's `content` is replaced by
   * `i18n[L].objects[objectId]` before evaluation (overlays are templates too, run
   * through the same expression allowlist). The base `content` is the authored
   * language; ONE definition thus prints in many languages without duplication.
   * A translatable object missing from a requested locale's overlay is reported in
   * `warnings[]` — never silently shown untranslated.
   */
  i18n?: Record<string, { objects?: Record<string, string> }>;
  page: ReportPageSetup;
  data: ReportDataConfig;
  bands: ReportBand[];
  permissions?: {
    /** report-app roles allowed to run/render (Designer + Administrator always may). */
    run_roles?: string[];
    /** report-app roles allowed to edit (Designer + Administrator always may). */
    edit_roles?: string[];
  };
}
