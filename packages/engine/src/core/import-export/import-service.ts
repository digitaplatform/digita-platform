import type {
  EntityDefinition,
  ImportMode,
  ImportReport,
  ImportRowError,
} from "@digitaplatform/shared";
import type { DocumentService } from "../document/document-service.js";
import { ValidationFailedError } from "../document/document-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { LinkValidator } from "../link/link-validator.js";
import type { UserContext } from "../permissions/types.js";
import type { ResponseContext } from "../api/response-context.js";
import { toIdString } from "../document/id-codec.js";
import { isStoredFieldType, FieldValueError } from "../entity/field-types.js";
import { ZodSchemaBuilder } from "../entity/zod-schema-builder.js";
import { validateEntityDataZod } from "../entity/entity-validator-zod.js";
import { BadRequestError } from "../view/view-engine.js";
import {
  BkResolver,
  businessKeyFields,
  businessKeyOf,
  resolveLinksByBk,
} from "./bk-resolver.js";
import { serializeRowForStorage } from "./row-serializer.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("import-service");

/** System-managed keys tolerated on input; stripped before the write pipeline
 *  (`_id` is kept only under `user_set` naming — there it is business content). */
const SYSTEM_KEYS = new Set([
  "_id",
  "doctype",
  "docstatus",
  "owner",
  "modified_by",
  "creation",
  "modified",
  "_link_titles",
]);

export class ImportService {
  constructor(
    private documentService: DocumentService,
    private registry: EntityRegistry,
    private db: MongoDBService,
    private permissionChecker: PermissionChecker,
    private linkValidator: LinkValidator,
    private bkResolver: BkResolver,
    private zodSchemaBuilder: ZodSchemaBuilder = new ZodSchemaBuilder(),
  ) {}

  /**
   * Import rows (already type-decoded — the router handles CSV cell decoding).
   * Generic + metadata-driven: modes insert | upsert | validate, Link resolution
   * by business key, in-file topological ordering (covers trees), continue-and-
   * report, and a full dry run. Each committed row runs the FULL DocumentService
   * pipeline (hooks / Zod / links / audit) in its own transaction.
   */
  async importData(
    doctype: string,
    rows: Record<string, unknown>[],
    user: UserContext,
    mode: ImportMode = "upsert",
    ctx?: ResponseContext,
  ): Promise<ImportReport> {
    const entity = this.registry.get(doctype);
    const report: ImportReport = {
      mode,
      dry_run: mode === "validate",
      total: rows.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      warnings: [],
    };

    // ── P0: entity-level guards ────────────────────────────
    if (entity.is_single) {
      throw new BadRequestError("import_single_not_supported");
    }
    const bkFields = businessKeyFields(entity);
    if (mode === "upsert" && !bkFields.length) {
      throw new BadRequestError("import_upsert_requires_business_key");
    }

    // ── P1: column allow-list (fail-loud before any write) ─
    const storedNames = new Set(
      entity.fields.filter((f) => isStoredFieldType(f.fieldtype)).map((f) => f.fieldname),
    );
    const unknown = new Set<string>();
    for (const raw of rows) {
      for (const key of Object.keys(raw)) {
        if (storedNames.has(key) || SYSTEM_KEYS.has(key)) continue;
        unknown.add(key);
      }
    }
    if (unknown.size) {
      throw new BadRequestError(`import_unknown_columns: ${[...unknown].join(", ")}`);
    }

    // Clone + strip system/underscore keys (never mutate caller input).
    const isUserSet = entity.naming?.strategy === "user_set";
    const strippedSys = new Set<string>();
    const cleaned = rows.map((raw) => this.clean(entity, raw, isUserSet, strippedSys));
    if (strippedSys.size) {
      report.warnings.push(`stripped system columns: ${[...strippedSys].join(", ")}`);
    }

    // ── P2: bk index of Link targets (+ self for upsert/tree) ─
    const hasSelfLink = this.hasSelfLink(entity, doctype);
    const bkIndex = await this.bkResolver.indexLinkTargets(entity, {
      includeSelf: mode === "upsert" || hasSelfLink,
    });
    const ownIdx = bkIndex.get(doctype);

    // Business keys present in THIS file — used both for topo ordering and to
    // let the dry run skip links that will only resolve once a sibling row is
    // inserted at commit.
    const inFileBks = new Set<string>();
    if (bkFields.length) {
      for (const row of cleaned) {
        const bk = businessKeyOf(row, bkFields);
        if (bk !== undefined) inFileBks.add(bk);
      }
    }

    // ── P3: topological order over in-file self-links (trees) ─
    const { order, cycle } = this.topoOrder(entity, doctype, cleaned, bkFields);

    // ── P4: per row, in order ──────────────────────────────
    for (const i of order) {
      const rowNo = i + 1;
      if (cycle.has(i)) {
        report.failed++;
        report.errors.push({
          row: rowNo,
          message: "circular reference between imported rows",
          message_key: "import_circular_reference",
        });
        continue;
      }
      const row = cleaned[i]!;
      try {
        // Resolve Link business keys → target _ids (recurses into child tables).
        resolveLinksByBk(entity.fields, row, bkIndex);

        const bkVal = bkFields.length ? businessKeyOf(row, bkFields) : undefined;

        if (mode === "validate") {
          const existingId = bkVal ? ownIdx?.get(bkVal) : undefined;
          await this.dryRunValidate(entity, row, inFileBks, user, !!existingId);
          if (existingId) report.updated++;
          else report.inserted++;
          continue;
        }

        if (mode === "upsert") {
          if (!bkVal) {
            report.failed++;
            report.errors.push({
              row: rowNo,
              message: "row is missing its business key",
              message_key: "import_missing_business_key",
            });
            continue;
          }
          const existingId = ownIdx?.get(bkVal);
          if (existingId) {
            await this.documentService.update(doctype, existingId, row, user);
            report.updated++;
          } else {
            const doc = await this.documentService.insert(doctype, row, user);
            report.inserted++;
            ownIdx?.set(bkVal, toIdString(doc._id));
          }
        } else {
          // insert
          const doc = await this.documentService.insert(doctype, row, user);
          report.inserted++;
          if (bkVal) ownIdx?.set(bkVal, toIdString(doc._id));
        }
      } catch (err) {
        report.failed++;
        report.errors.push(this.toRowError(err, rowNo));
      }
    }

    // ── P5: aggregate messages ─────────────────────────────
    const succeeded = report.inserted + report.updated;
    if (succeeded > 0 && !report.dry_run) {
      ctx?.success("import_success", { count: String(succeeded) });
    }
    for (const e of report.errors) {
      ctx?.error("import_failed_row", { row: String(e.row), error: e.message });
    }

    log.info(
      { doctype, mode, inserted: report.inserted, updated: report.updated, failed: report.failed },
      "Import completed",
    );
    return report;
  }

  // ── helpers ──────────────────────────────────────────────

  /** Clone a raw row: strip system keys (keep `_id` under user_set) + `_`-keys in child rows. */
  private clean(
    entity: EntityDefinition,
    raw: Record<string, unknown>,
    isUserSet: boolean,
    strippedSys: Set<string>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (SYSTEM_KEYS.has(key)) {
        if (key === "_id" && isUserSet) {
          row[key] = value;
          continue;
        }
        strippedSys.add(key);
        continue;
      }
      row[key] = value;
    }
    for (const field of entity.fields) {
      if (field.fieldtype === "Table" && Array.isArray(row[field.fieldname])) {
        row[field.fieldname] = (row[field.fieldname] as Record<string, unknown>[]).map((child) => {
          const c: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(child)) {
            if (k.startsWith("_")) continue;
            c[k] = v;
          }
          return c;
        });
      }
    }
    return row;
  }

  /** Whether the entity has any top-level self-referential Link (e.g. a tree parent). */
  private hasSelfLink(entity: EntityDefinition, doctype: string): boolean {
    return entity.fields.some(
      (f) => f.fieldtype === "Link" && f.target === doctype,
    );
  }

  /**
   * Order rows so a self-link parent precedes its children (tree files uploaded
   * child-before-parent still import). Only top-level self-Link fields are edges
   * (a tree `parent_field` is one). Cycles are returned as a set — their members
   * fail with `import_circular_reference`; the rest still process.
   */
  private topoOrder(
    entity: EntityDefinition,
    doctype: string,
    rows: Record<string, unknown>[],
    bkFields: string[],
  ): { order: number[]; cycle: Set<number> } {
    const n = rows.length;
    const selfLinks = entity.fields
      .filter((f) => f.fieldtype === "Link" && f.target === doctype)
      .map((f) => f.fieldname);
    if (!bkFields.length || selfLinks.length === 0) {
      return { order: Array.from({ length: n }, (_, i) => i), cycle: new Set() };
    }

    // Map each in-file bk → row index.
    const bkToIndex = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const bk = businessKeyOf(rows[i]!, bkFields);
      if (bk !== undefined && !bkToIndex.has(bk)) bkToIndex.set(bk, i);
    }

    // Edges parent → child. indeg[child]++.
    const adj: number[][] = Array.from({ length: n }, () => []);
    const indeg = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (const fname of selfLinks) {
        const v = rows[i]![fname];
        if (v == null) continue;
        const parent = bkToIndex.get(String(v));
        if (parent !== undefined && parent !== i) {
          adj[parent]!.push(i);
          indeg[i]!++;
        }
      }
    }

    // Kahn — preserve original order among ready nodes.
    const order: number[] = [];
    const queue: number[] = [];
    for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
    while (queue.length) {
      const u = queue.shift()!;
      order.push(u);
      for (const v of adj[u]!) {
        if (--indeg[v]! === 0) queue.push(v);
      }
    }
    const cycle = new Set<number>();
    if (order.length < n) {
      for (let i = 0; i < n; i++) if (indeg[i]! > 0) cycle.add(i);
      // Append cycle members so they still get a reported row error, last.
      for (const i of cycle) order.push(i);
    }
    return { order, cycle };
  }

  /** Full schema + link + permission check with ZERO writes. */
  private async dryRunValidate(
    entity: EntityDefinition,
    row: Record<string, unknown>,
    inFileBks: Set<string>,
    user: UserContext,
    isUpdate: boolean,
  ): Promise<void> {
    const data = serializeRowForStorage(entity, row);

    const zres = validateEntityDataZod(entity, data, this.zodSchemaBuilder, !isUpdate);
    if (!zres.valid) throw new ValidationFailedError(entity.name, zres.errors);

    // Skip self-links that will only resolve once a sibling row commits.
    const linkData = this.stripInFileSelfLinks(entity, data, inFileBks);
    const linkErrors = await this.linkValidator.validate(entity, linkData);
    if (linkErrors.length) {
      throw new ValidationFailedError(
        entity.name,
        linkErrors.map((e) => ({ field: e.field, message_key: e.message_key, params: e.params })),
      );
    }

    await this.permissionChecker.check(user, entity.name, isUpdate ? "write" : "create");
  }

  /** Blank out self-target Link values that point at another as-yet-uninserted in-file row. */
  private stripInFileSelfLinks(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    inFileBks: Set<string>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    for (const field of entity.fields) {
      if (
        field.fieldtype === "Link" &&
        field.target === entity.name &&
        typeof out[field.fieldname] === "string" &&
        inFileBks.has(out[field.fieldname] as string)
      ) {
        delete out[field.fieldname];
      }
    }
    return out;
  }

  private toRowError(err: unknown, row: number): ImportRowError {
    if (err instanceof ValidationFailedError && err.errors.length) {
      const e = err.errors[0]!;
      return {
        row,
        field: e.field,
        message: e.field ? `${e.field}: ${e.message_key}` : e.message_key,
        message_key: e.message_key,
        params: e.params,
      };
    }
    if (err instanceof FieldValueError) {
      return {
        row,
        field: err.field,
        message: err.message_key,
        message_key: err.message_key,
        params: err.params,
      };
    }
    return { row, message: (err as Error).message };
  }
}
