import type { EntityDefinition, DatabaseTarget, FieldDefinition } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES, ROW_ID_FIELD } from "@digitaplatform/shared";
import type { ClientSession } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { parseSubRowLink } from "../document/row-id.js";

/** Read a dotted path out of a document (supports nested objects). */
function navigatePath(doc: unknown, path: string): unknown {
  let value: unknown = doc;
  for (const part of path.split(".")) {
    if (value && typeof value === "object") {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return value;
}

interface FetchRequest {
  db: DatabaseTarget;
  target: string;
  id: string;
  path: string;
  /** For sub-row (target_path) Links: the Table field on the source doc + the
   *  _row_id to locate within it before navigating `path`. */
  targetPath?: string;
  rowId?: string;
  assign: (value: unknown) => void;
}

/**
 * Resolve fetch_from fields: auto-fill values from linked documents.
 *
 * A field declares `fetch_from: "<linkField>.<sourcePath>"`. The linked doc's
 * named path is copied into this field. Distinct from `snapshot` (frozen at
 * submit-time); fetch_from is a soft default the user can override before save.
 *
 * Batched (D10a): instead of one query per link reference, every needed lookup
 * is collected first, then fetched with a single `$in` query per
 * (database, target) — the "one courier with the shopping list" pattern.
 */
export class FetchFromResolver {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
  ) {}

  async resolve(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<Record<string, unknown>> {
    const result = { ...data };
    const requests: FetchRequest[] = [];

    // ── Phase 1: collect every fetch_from lookup (top-level + child rows) ──
    for (const field of entity.fields) {
      if (!field.fetch_from || LAYOUT_FIELD_TYPES.includes(field.fieldtype)) continue;
      const parts = field.fetch_from.split(".");
      if (parts.length < 2) continue;
      const linkFieldname = parts[0]!;
      const path = parts.slice(1).join(".");

      if (field.fetch_if_empty) {
        const current = data[field.fieldname];
        if (current !== null && current !== undefined && current !== "") continue;
      }
      const linkedId = data[linkFieldname];
      if (!linkedId) continue;

      const linkField = entity.fields.find((f) => f.fieldname === linkFieldname);
      if (!linkField || linkField.fieldtype !== "Link" || !linkField.target) continue;

      // Sub-row (target_path) Link: the stored value is a composite
      // `<parentId>::<rowId>` — look up the PARENT doc, then the named row.
      let lookupId = String(linkedId);
      let targetPath: string | undefined;
      let rowId: string | undefined;
      if (linkField.target_path) {
        const parsed = parseSubRowLink(lookupId);
        if (!parsed) continue;
        lookupId = parsed.parentId;
        targetPath = linkField.target_path;
        rowId = parsed.rowId;
      }

      requests.push({
        db: this.registry.get(linkField.target).database,
        target: linkField.target,
        id: lookupId,
        path,
        targetPath,
        rowId,
        assign: (v) => {
          if (v !== undefined) result[field.fieldname] = v;
        },
      });
    }

    for (const field of entity.fields) {
      if (field.fieldtype !== "Table" || !field.child_fields) continue;
      const rows = result[field.fieldname];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) this.collectRowRequests(field, row as Record<string, unknown>, requests);
    }

    await this.fetchInto(requests, session);
    return result;
  }

  /**
   * On an update, re-derive the fetch_from fields of each child row that the
   * write adds or whose source Link differs from its row in `stored`, matched by
   * `_row_id`. A new row resolves as on insert. In a row whose source changed, a
   * `fetch_if_empty` field also re-derives while it still holds its stored
   * value, so a value the same write sets is kept. Every other row stays as it
   * is. The rows of `data` change in place.
   */
  async resolveChangedRows(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    stored: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<void> {
    const requests: FetchRequest[] = [];
    for (const field of entity.fields) {
      if (field.fieldtype !== "Table" || !field.child_fields) continue;
      const rows = data[field.fieldname];
      if (!Array.isArray(rows)) continue;
      const storedRows = new Map<string, Record<string, unknown>>();
      const storedTable = stored[field.fieldname];
      for (const storedRow of Array.isArray(storedTable) ? (storedTable as Array<Record<string, unknown>>) : []) {
        const rowId = storedRow?.[ROW_ID_FIELD];
        if (typeof rowId === "string") storedRows.set(rowId, storedRow);
      }
      for (const row of rows) {
        const rowData = row as Record<string, unknown>;
        const rowId = rowData[ROW_ID_FIELD];
        this.collectRowRequests(field, rowData, requests, typeof rowId === "string" ? storedRows.get(rowId) : undefined);
      }
    }
    await this.fetchInto(requests, session);
  }

  /**
   * Collect the lookups of one child row. Without `storedRow` every fetch_from
   * field resolves, a `fetch_if_empty` one only while empty. With it, only the
   * fields whose source Link differs from `storedRow` resolve.
   */
  private collectRowRequests(
    field: FieldDefinition,
    rowData: Record<string, unknown>,
    requests: FetchRequest[],
    storedRow?: Record<string, unknown>,
  ): void {
    for (const childField of field.child_fields ?? []) {
      if (!childField.fetch_from) continue;
      const parts = childField.fetch_from.split(".");
      if (parts.length < 2) continue;
      const linkFieldname = parts[0]!;
      const path = parts.slice(1).join(".");

      if (storedRow && storedRow[linkFieldname] === rowData[linkFieldname]) continue;
      if (childField.fetch_if_empty) {
        const current = rowData[childField.fieldname];
        const isEmpty = current === null || current === undefined || current === "";
        // Compared as JSON: a stored Date comes back from the client as its ISO string.
        const isStoredValue =
          storedRow !== undefined && JSON.stringify(current) === JSON.stringify(storedRow[childField.fieldname]);
        if (!isEmpty && !isStoredValue) continue;
      }
      const linkedId = rowData[linkFieldname];
      if (!linkedId) continue;

      const linkField = field.child_fields?.find((f) => f.fieldname === linkFieldname);
      if (!linkField || linkField.fieldtype !== "Link" || !linkField.target) continue;

      let lookupId = String(linkedId);
      let targetPath: string | undefined;
      let rowId: string | undefined;
      if (linkField.target_path) {
        const parsed = parseSubRowLink(lookupId);
        if (!parsed) continue;
        lookupId = parsed.parentId;
        targetPath = linkField.target_path;
        rowId = parsed.rowId;
      }

      requests.push({
        db: this.registry.get(linkField.target).database,
        target: linkField.target,
        id: lookupId,
        path,
        targetPath,
        rowId,
        // A row whose Link moved to a source without this path clears the field, as an insert
        // with that source stores none; otherwise the old source's value would stay.
        assign: (v) => {
          if (v !== undefined) rowData[childField.fieldname] = v;
          else if (storedRow) rowData[childField.fieldname] = null;
        },
      });
    }
  }

  /** Fetch every collected lookup, one `$in` query per (database, target), and assign the values. */
  private async fetchInto(requests: FetchRequest[], session?: ClientSession): Promise<void> {
    if (requests.length === 0) return;

    // ── Phase 2: one $in query per (db, target) ──────────────────────────
    const groups = new Map<string, { db: DatabaseTarget; target: string; ids: Set<string> }>();
    for (const r of requests) {
      const key = `${String(r.db)}:${r.target}`;
      let group = groups.get(key);
      if (!group) {
        group = { db: r.db, target: r.target, ids: new Set() };
        groups.set(key, group);
      }
      group.ids.add(r.id);
    }

    // One query after the other: the driver does not support parallel operations
    // inside a transaction, and `session` may be one.
    const docsByGroup = new Map<string, Map<string, Record<string, unknown>>>();
    for (const group of groups.values()) {
      const docs = await this.db.find(
        group.target,
        { filters: [{ _id: { $in: [...group.ids] } }] },
        group.db,
        session,
      );
      const byId = new Map<string, Record<string, unknown>>();
      for (const doc of docs) {
        byId.set(String((doc as Record<string, unknown>)["_id"]), doc as Record<string, unknown>);
      }
      docsByGroup.set(`${String(group.db)}:${group.target}`, byId);
    }

    // ── Phase 3: assign resolved values ──────────────────────────────────
    for (const r of requests) {
      const doc = docsByGroup.get(`${String(r.db)}:${r.target}`)?.get(r.id);
      if (!doc) continue;
      // For a sub-row (target_path) Link, navigate INSIDE the named row of the
      // parent doc rather than the parent doc itself.
      let source: Record<string, unknown> | undefined = doc;
      if (r.targetPath) {
        const subRows = doc[r.targetPath];
        if (!Array.isArray(subRows)) continue;
        source = subRows.find(
          (row) => (row as Record<string, unknown>)[ROW_ID_FIELD] === r.rowId,
        ) as Record<string, unknown> | undefined;
        if (!source) continue;
      }
      r.assign(navigatePath(source, r.path));
    }
  }
}
