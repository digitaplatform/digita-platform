import type { EntityDefinition, DatabaseTarget } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES, ROW_ID_FIELD } from "@digitaplatform/shared";
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

      for (const row of rows) {
        const rowData = row as Record<string, unknown>;
        for (const childField of field.child_fields) {
          if (!childField.fetch_from) continue;
          const parts = childField.fetch_from.split(".");
          if (parts.length < 2) continue;
          const linkFieldname = parts[0]!;
          const path = parts.slice(1).join(".");

          if (childField.fetch_if_empty) {
            const current = rowData[childField.fieldname];
            if (current !== null && current !== undefined && current !== "") continue;
          }
          const linkedId = rowData[linkFieldname];
          if (!linkedId) continue;

          const linkField = field.child_fields.find((f) => f.fieldname === linkFieldname);
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
            assign: (v) => {
              if (v !== undefined) rowData[childField.fieldname] = v;
            },
          });
        }
      }
    }

    if (requests.length === 0) return result;

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

    const docsByGroup = new Map<string, Map<string, Record<string, unknown>>>();
    await Promise.all(
      [...groups.values()].map(async (group) => {
        const docs = await this.db.find(
          group.target,
          { filters: [{ _id: { $in: [...group.ids] } }] },
          group.db,
        );
        const byId = new Map<string, Record<string, unknown>>();
        for (const doc of docs) {
          byId.set(String((doc as Record<string, unknown>)["_id"]), doc as Record<string, unknown>);
        }
        docsByGroup.set(`${String(group.db)}:${group.target}`, byId);
      }),
    );

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

    return result;
  }
}
