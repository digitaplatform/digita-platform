import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES } from "@digitaplatform/shared";
import type { DocumentService } from "../document/document-service.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { UserContext } from "../permissions/types.js";
import { businessKeyFields, type BkResolver } from "./bk-resolver.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("export-service");

/** System columns injected by getList that a round-trip export must strip. */
const ROUND_TRIP_STRIP = [
  "doctype",
  "docstatus",
  "owner",
  "modified_by",
  "creation",
  "modified",
  "_link_titles",
] as const;

export interface ExportOptions {
  /** `id` (default) keeps raw `_id`s; `business_key` translates Link `_id`s
   *  back to the target's human-facing business key for a re-importable file. */
  linkFormat?: "id" | "business_key";
  /** Strip system/snapshot columns so each row is directly re-insertable and
   *  deep-equal-stable. Forces `linkFormat=business_key`. */
  roundTrip?: boolean;
}

export class ExportService {
  constructor(
    private documentService: DocumentService,
    private registry: EntityRegistry,
    private bkResolver: BkResolver,
  ) {}

  /**
   * Export documents as an array of flat objects (for CSV/JSON).
   */
  async exportData(
    doctype: string,
    filters?: [string, string, unknown][],
    limit: number = 50000,
    user?: UserContext,
    opts: ExportOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const entity = this.registry.get(doctype);
    // B5 fix: Table child-fields are exported ALWAYS (previously dropped, which
    // made master-detail export header-only and round-trip impossible).
    const storedFields = entity.fields
      .filter((f) => !LAYOUT_FIELD_TYPES.includes(f.fieldtype))
      .map((f) => f.fieldname);

    // Add standard fields. SEC: a permission `condition` is an arbitrary
    // expression evaluated per-row by getList's conditional-read re-check. A
    // projection that omits docstatus makes `doc.docstatus` read as null there
    // (a missing member maps to null), so an exclude-style grant like
    // `eval:doc.docstatus != 2` fails OPEN and leaks cancelled/hidden rows.
    // Always project the system fields a condition may reference; filterFieldsForRead
    // still masks per read-level, and docstatus is always readable.
    const fields = [
      "_id",
      ...storedFields,
      "creation",
      "modified",
      "owner",
      "docstatus",
      "modified_by",
      "doctype",
    ];

    // H2: export must run as the CALLER, not the default GUEST_USER, so getList
    // applies the caller's own select gate + scope/if_owner/condition — it must
    // neither break for entities without a Guest grant nor dump out-of-scope rows.
    const result = await this.documentService.getList(
      doctype,
      { fields, filters, limit, offset: 0 },
      user,
    );

    let rows = result.data;

    const linkFormat = opts.roundTrip ? "business_key" : (opts.linkFormat ?? "id");
    if (linkFormat === "business_key") {
      await this.translateLinksToBk(entity, rows);
    }

    if (opts.roundTrip) {
      rows = rows.map((row) => this.stripForRoundTrip(entity, row));
    }

    log.info({ doctype, count: rows.length, linkFormat, roundTrip: !!opts.roundTrip }, "Export completed");

    return rows;
  }

  /**
   * Replace Link `_id` values with the target's business key, batch-resolved
   * (ONE `$in` per target, no N+1). Covers top-level Links AND Links inside
   * each Table's child rows (a self-link / tree parent is just `target === doctype`).
   * Targets without a business key are left untouched — their `_id` IS the key.
   * A dangling `_id` (no matching target doc) also stays as-is: export is not
   * the fail-loud boundary.
   */
  private async translateLinksToBk(
    entity: EntityDefinition,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    // Collect bk-bearing Link targets and the distinct ids referenced per target.
    const idsByTarget = new Map<string, Set<string>>();
    const collectLinks = (
      fields: FieldDefinition[],
      row: Record<string, unknown>,
    ): void => {
      for (const field of fields) {
        if (field.fieldtype === "Link" && field.target) {
          if (!this.registry.has(field.target)) continue;
          if (!businessKeyFields(this.registry.get(field.target)).length) continue;
          const v = row[field.fieldname];
          if (v == null) continue;
          (idsByTarget.get(field.target) ?? idsByTarget.set(field.target, new Set()).get(field.target)!).add(
            String(v),
          );
        } else if (field.fieldtype === "Table" && Array.isArray(row[field.fieldname])) {
          for (const child of row[field.fieldname] as Record<string, unknown>[]) {
            collectLinks(field.child_fields ?? [], child);
          }
        }
      }
    };
    for (const row of rows) collectLinks(entity.fields, row);

    if (idsByTarget.size === 0) return;

    // One batched reverse lookup per target.
    const bkByTarget = new Map<string, Map<string, string>>();
    for (const [target, ids] of idsByTarget) {
      bkByTarget.set(target, await this.bkResolver.idToBkMap(this.registry.get(target), [...ids]));
    }

    // Replace values in place.
    const applyLinks = (
      fields: FieldDefinition[],
      row: Record<string, unknown>,
    ): void => {
      for (const field of fields) {
        if (field.fieldtype === "Link" && field.target) {
          const map = bkByTarget.get(field.target);
          if (!map) continue;
          const v = row[field.fieldname];
          if (v == null) continue;
          const bk = map.get(String(v));
          if (bk !== undefined) row[field.fieldname] = bk;
        } else if (field.fieldtype === "Table" && Array.isArray(row[field.fieldname])) {
          for (const child of row[field.fieldname] as Record<string, unknown>[]) {
            applyLinks(field.child_fields ?? [], child);
          }
        }
      }
    };
    for (const row of rows) applyLinks(entity.fields, row);
  }

  /**
   * Strip system/snapshot columns so a row is directly re-insertable. `_id` is
   * kept ONLY under `user_set` naming (where it is caller-supplied and part of
   * the business content); every `_`-prefixed key inside Table child rows
   * (e.g. `_row_id`) is dropped — regenerated on insert.
   */
  private stripForRoundTrip(
    entity: EntityDefinition,
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if ((ROUND_TRIP_STRIP as readonly string[]).includes(key)) continue;
      if (key === "_id" && entity.naming?.strategy !== "user_set") continue;
      out[key] = value;
    }
    // Strip _-prefixed keys inside Table child rows.
    for (const field of entity.fields) {
      if (field.fieldtype === "Table" && Array.isArray(out[field.fieldname])) {
        out[field.fieldname] = (out[field.fieldname] as Record<string, unknown>[]).map((child) => {
          const c: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(child)) {
            if (k.startsWith("_")) continue;
            c[k] = v;
          }
          return c;
        });
      }
    }
    return out;
  }
}
