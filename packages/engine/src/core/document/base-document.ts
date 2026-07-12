import type { DocStatus } from "@digitaplatform/shared";
import { ROW_ID_FIELD } from "@digitaplatform/shared";
import { generateRowId } from "./row-id.js";
import { toIdString, toIdStorage } from "./id-codec.js";

/**
 * Inject a stable `_row_id` onto every plain-object row of every array in `data`
 * that lacks one. Type-blind by design (`_row_id` is a harmless extra key on
 * non-Table arrays). Returns the keys it mutated so callers can mark them dirty.
 *
 * Shared by `BaseDocument.ensureRowIds` (the normal write path) AND the seed
 * loader — seeded child rows must get `_row_id` too, otherwise sub-row Links
 * (`field.target_path` resolvers) cannot reference them.
 */
export function injectRowIds(data: Record<string, unknown>): string[] {
  const mutatedKeys: string[] = [];
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    let mutated = false;
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r[ROW_ID_FIELD] !== "string" || !r[ROW_ID_FIELD]) {
        r[ROW_ID_FIELD] = generateRowId();
        mutated = true;
      }
    }
    if (mutated) mutatedKeys.push(key);
  }
  return mutatedKeys;
}

/**
 * Base document representation.
 * Wraps raw MongoDB data with change tracking and helpers.
 */
export class BaseDocument {
  // Identity
  _id: string = "";
  doctype: string = "";

  // Standard fields
  docstatus: DocStatus = 0;
  owner: string = "";
  modified_by: string = "";
  creation: Date = new Date();
  modified: Date = new Date();

  // Internal state
  _data: Record<string, unknown> = {};
  _original: Record<string, unknown> = {};
  _dirty: Set<string> = new Set();
  _isNew: boolean = true;

  // Link titles (resolved on read)
  _link_titles: Record<string, string> = {};
  _status_indicator?: { color: string };

  constructor(doctype: string, data?: Record<string, unknown>) {
    this.doctype = doctype;
    if (data) {
      this.loadFromData(data);
    }
  }

  /**
   * Load data from a MongoDB document.
   */
  loadFromData(data: Record<string, unknown>): void {
    this._data = { ...data };
    this.ensureRowIds();
    this._original = { ...this._data };
    this._dirty.clear();
    this._isNew = false;

    // _id stays a string in memory (native ObjectId → 24-hex). Normalize the
    // copy held in _data too, so the spread in toJSON/toMongo carries the string.
    this._id = toIdString(data["_id"]);
    this._data["_id"] = this._id;
    this.doctype = (data["doctype"] as string) ?? this.doctype;
    this.docstatus = (data["docstatus"] as DocStatus) ?? 0;
    this.owner = (data["owner"] as string) ?? "";
    this.modified_by = (data["modified_by"] as string) ?? "";
    this.creation =
      data["creation"] instanceof Date
        ? data["creation"]
        : new Date((data["creation"] as string) ?? Date.now());
    this.modified =
      data["modified"] instanceof Date
        ? data["modified"]
        : new Date((data["modified"] as string) ?? Date.now());
  }

  /**
   * Walk every value in `_data`. For any array whose elements are plain
   * objects, inject a stable `_row_id` (16-char ULID-like) onto each
   * row that doesn't already have one. Type-blind by design — `_row_id`
   * is just an extra key, harmless on non-Table arrays.
   *
   * Without this, sub-row Links (`field.target_path`) cannot reference
   * rows that were inserted via raw data assignment (e.g. when callers
   * pass `addresses: [...]` directly to `docService.insert` instead of
   * going through `addChild`). audit identified this as the
   * blocker for a sub-row `target_path` resolver returning null even when a
   * matching child row existed.
   *
   * Called automatically after every `_data` reset (loadFromData and
   * the direct-assignment path in DocumentService.insert).
   */
  ensureRowIds(): void {
    // Mark each mutated field dirty so an UPDATE persists the freshly minted
    // row_ids back to the database. New inserts ignore the dirty set (full doc
    // is written), so this is a no-op for new docs.
    for (const key of injectRowIds(this._data)) {
      this._dirty.add(key);
    }
  }

  // ─── Field Access ──────────────────────────────────────

  get(fieldname: string): unknown {
    return this._data[fieldname];
  }

  set(fieldname: string, value: unknown): void {
    const oldValue = this._data[fieldname];
    // Primitives: skip dirty mark when the value didn't actually change.
    // Objects / arrays: ALWAYS mark dirty. The reference-equality short-circuit
    // would silently drop in-place mutations like:
    //
    //   const lines = doc.getChildren("lines");   // returns _data["lines"] ref
    //   lines[0].amount = 99;                      // in-place mutate
    //   doc.set("lines", lines);                   // same ref ← used to skip dirty
    //
    // …which left the mutation un-persisted on UPDATE (getChanges() omits
    // non-dirty fields). For objects/arrays we can't cheaply diff, so we
    // pessimistically assume the contents may have changed.
    const isObjectLike = value !== null && typeof value === "object";
    if (isObjectLike || oldValue !== value) {
      this._data[fieldname] = value;
      this._dirty.add(fieldname);
    }
  }

  /**
   * Merge multiple field values.
   */
  merge(data: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(data)) {
      // Skip standard fields and internal fields
      if (key.startsWith("_") && key !== "_id") continue;
      this.set(key, value);
    }
  }

  // ─── Change Tracking ──────────────────────────────────

  hasChanged(fieldname?: string): boolean {
    if (fieldname) {
      return this._dirty.has(fieldname);
    }
    return this._dirty.size > 0;
  }

  getChangedFields(): string[] {
    return Array.from(this._dirty);
  }

  getPreviousValue(fieldname: string): unknown {
    return this._original[fieldname];
  }

  /**
   * Get only the changed fields for a partial update.
   */
  getChanges(): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    for (const field of this._dirty) {
      changes[field] = this._data[field];
    }
    changes["modified"] = this.modified;
    changes["modified_by"] = this.modified_by;
    return changes;
  }

  // ─── Child Table Helpers ──────────────────────────────

  getChildren(fieldname: string): Record<string, unknown>[] {
    const value = this._data[fieldname];
    if (!Array.isArray(value)) return [];
    return value as Record<string, unknown>[];
  }

  addChild(fieldname: string, data: Record<string, unknown> = {}): Record<string, unknown> {
    const children = this.getChildren(fieldname);
    const child: Record<string, unknown> = {
      ...data,
      idx: children.length,
    };
    // Stable per-row identity. Honor a caller-supplied `_row_id` if present;
    // otherwise auto-generate. Required for sub-row Links (`target_path`) and
    // row-aware delete-protection.
    if (typeof child[ROW_ID_FIELD] !== "string" || !child[ROW_ID_FIELD]) {
      child[ROW_ID_FIELD] = generateRowId();
    }
    children.push(child);
    this._data[fieldname] = children;
    this._dirty.add(fieldname);
    return child;
  }

  removeChild(fieldname: string, idx: number): void {
    const children = this.getChildren(fieldname);
    children.splice(idx, 1);
    // Re-index `idx` for display order. `_row_id` is preserved as the
    // stable handle; `idx` is now display-only.
    children.forEach((child, i) => {
      child["idx"] = i;
    });
    this._data[fieldname] = children;
    this._dirty.add(fieldname);
  }

  /**
   * Find a row by its stable `_row_id`. Preferred handle over array index.
   */
  getChildById(fieldname: string, rowId: string): Record<string, unknown> | undefined {
    return this.getChildren(fieldname).find((r) => r[ROW_ID_FIELD] === rowId);
  }

  /**
   * Remove a row by `_row_id`. No-op when the row doesn't exist.
   */
  removeChildById(fieldname: string, rowId: string): void {
    const children = this.getChildren(fieldname);
    const i = children.findIndex((r) => r[ROW_ID_FIELD] === rowId);
    if (i < 0) return;
    children.splice(i, 1);
    children.forEach((child, j) => {
      child["idx"] = j;
    });
    this._data[fieldname] = children;
    this._dirty.add(fieldname);
  }

  /**
   * Patch a row by `_row_id`. Returns true on hit, false when row missing.
   * Patches cannot change `_row_id`.
   */
  updateChildById(fieldname: string, rowId: string, patch: Record<string, unknown>): boolean {
    const children = this.getChildren(fieldname);
    const i = children.findIndex((r) => r[ROW_ID_FIELD] === rowId);
    if (i < 0) return false;
    const { [ROW_ID_FIELD]: _ignored, ...rest } = patch;
    children[i] = { ...children[i], ...rest };
    this._data[fieldname] = children;
    this._dirty.add(fieldname);
    return true;
  }

  clearChildren(fieldname: string): void {
    this._data[fieldname] = [];
    this._dirty.add(fieldname);
  }

  // ─── Conversion ────────────────────────────────────────

  /**
   * Convert to plain object for API response.
   */
  toJSON(): Record<string, unknown> {
    return {
      ...this._data,
      _id: this._id,
      doctype: this.doctype,
      docstatus: this.docstatus,
      owner: this.owner,
      modified_by: this.modified_by,
      creation: this.creation.toISOString(),
      modified: this.modified.toISOString(),
      _link_titles: Object.keys(this._link_titles).length > 0 ? this._link_titles : undefined,
      _status_indicator: this._status_indicator,
    };
  }

  /**
   * Convert to plain object for MongoDB storage.
   */
  toMongo(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      _id: this._id,
      doctype: this.doctype,
      docstatus: this.docstatus,
      owner: this.owner,
      modified_by: this.modified_by,
      creation: this.creation,
      modified: this.modified,
      ...this._data,
    };
    // Force _id to its storage form last (a 24-hex string → native ObjectId for
    // `system` naming), overriding the string copy carried in _data.
    out["_id"] = toIdStorage(this._id);
    return out;
  }
}
