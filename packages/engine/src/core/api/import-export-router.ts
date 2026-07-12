import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import type { EntityDefinition, ImportMode } from "@digitaplatform/shared";
import type { ImportService } from "../import-export/import-service.js";
import type { ExportService } from "../import-export/export-service.js";
import { decodeCsvRows } from "../import-export/csv-codec.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { UserContext } from "../permissions/types.js";
import { isStoredFieldType } from "../entity/field-types.js";
import { BadRequestError } from "../view/view-engine.js";
import { env } from "../config/env.js";
import { ResponseContext } from "./response-context.js";
import { successResponse } from "./response-model.js";

const GUEST_USER: UserContext = { _id: "Guest", email: "Guest", roles: ["Guest"] };

const IMPORT_MODES: ReadonlySet<ImportMode> = new Set<ImportMode>(["insert", "upsert", "validate"]);

export function registerImportExportRoutes(
  app: FastifyInstance,
  prefix: string,
  importService: ImportService,
  exportService: ExportService,
  permissionChecker: PermissionChecker,
  registry: EntityRegistry,
): void {
  // Import documents from a JSON `rows` body OR a `csv` string (parsed +
  // type-decoded server-side, D2). Per-row permission is enforced by
  // documentService.insert/update; the route additionally requires the
  // dedicated "import" permission so admins can offer create-but-not-bulk-import.
  app.post(`${prefix}/import/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const body = request.body as
      | { rows?: unknown; csv?: unknown; mode?: unknown }
      | undefined;

    const hasRows = !!body && Array.isArray(body.rows);
    const hasCsv = !!body && typeof body.csv === "string";
    if (hasRows === hasCsv) {
      throw new BadRequestError("request body must include exactly one of 'rows' (array) or 'csv' (string)");
    }

    const mode: ImportMode = body?.mode === undefined ? "upsert" : (body.mode as ImportMode);
    if (!IMPORT_MODES.has(mode)) {
      throw new BadRequestError(`'mode' must be one of insert | upsert | validate`);
    }

    // registry.get throws a clean entity_not_found for an unknown doctype.
    const entity = registry.get(doctype);

    let rows: Record<string, unknown>[];
    if (hasCsv) {
      let parsed: Record<string, string>[];
      try {
        parsed = parse(body!.csv as string, {
          columns: true,
          bom: true,
          skip_empty_lines: true,
        }) as Record<string, string>[];
      } catch (e) {
        throw new BadRequestError(`csv parse error: ${(e as Error).message}`);
      }
      rows = decodeCsvRows(entity, parsed);
    } else {
      rows = body!.rows as Record<string, unknown>[];
    }

    if (rows.length === 0) {
      throw new BadRequestError("nothing to import: 0 rows");
    }
    // Enforce the anti-DoS cap (previously enforced nowhere). Body size is
    // separately bounded by API_MAX_BODY_SIZE.
    if (rows.length > env.IMPORT_MAX_ROWS) {
      throw new BadRequestError(
        `too many rows (${rows.length}); the maximum is ${env.IMPORT_MAX_ROWS}`,
      );
    }

    const user = request.user ?? GUEST_USER;
    const ctx = new ResponseContext();

    await permissionChecker.check(user, doctype, "import");

    const report = await importService.importData(doctype, rows, user, mode, ctx);
    return reply.send(successResponse(report, ctx.getMessages()));
  });

  // Export documents as JSON (default) or CSV. Read-time permission for
  // individual rows happens in exportService → documentService.getList
  // ("select"); the route additionally requires the dedicated "export" permission.
  app.get(`${prefix}/export/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const query = request.query as Record<string, string>;

    // Malformed filters must be a clean 400, not a 500 from an unhandled parse.
    let filters: [string, string, unknown][] | undefined;
    if (query["filters"]) {
      try {
        filters = JSON.parse(query["filters"]);
      } catch {
        throw new BadRequestError("query param 'filters' is not valid JSON");
      }
    }

    // Enforce the anti-DoS cap: an uncapped limit could dump the whole
    // collection. Reject loudly (rather than silently truncate) when the caller
    // asks for more than EXPORT_MAX_ROWS; default to the cap when unspecified.
    const limit = parseInt(query["limit"] ?? String(env.EXPORT_MAX_ROWS), 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new BadRequestError("query param 'limit' must be a positive integer");
    }
    if (limit > env.EXPORT_MAX_ROWS) {
      throw new BadRequestError(
        `query param 'limit' exceeds the maximum of ${env.EXPORT_MAX_ROWS}`,
      );
    }

    // Round-trip / link-format params.
    const roundTrip = query["round_trip"] === "true";
    const rawLinkFormat = query["link_format"];
    if (rawLinkFormat !== undefined && rawLinkFormat !== "id" && rawLinkFormat !== "business_key") {
      throw new BadRequestError("query param 'link_format' must be 'id' or 'business_key'");
    }
    if (roundTrip && rawLinkFormat === "id") {
      throw new BadRequestError("round_trip=true is incompatible with link_format=id");
    }
    const linkFormat: "id" | "business_key" =
      roundTrip || rawLinkFormat === "business_key" ? "business_key" : "id";

    const format = query["format"] ?? "json";
    if (format !== "json" && format !== "csv") {
      throw new BadRequestError("query param 'format' must be 'json' or 'csv'");
    }

    const user = request.user ?? GUEST_USER;
    await permissionChecker.check(user, doctype, "export");

    const data = await exportService.exportData(doctype, filters, limit, user, {
      linkFormat,
      roundTrip,
    });

    if (format === "csv") {
      const entity = registry.get(doctype);
      const csv = toCsv(entity, data);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${doctype}.csv"`)
        .send(csv);
    }

    return reply.send(successResponse(data));
  });
}

/**
 * Serialize export rows to CSV. Columns follow the entity's stored-field order
 * (`_id` first when present, then any extra keys), object/array cells are
 * JSON-stringified (mirrors the UI's client-side CSV). No BOM — the UI's
 * downloadCsv prepends one.
 */
function toCsv(entity: EntityDefinition, rows: Record<string, unknown>[]): string {
  const cols: string[] = [];
  const seen = new Set<string>();
  const push = (k: string): void => {
    if (!seen.has(k)) {
      seen.add(k);
      cols.push(k);
    }
  };
  if (rows.some((r) => "_id" in r)) push("_id");
  for (const f of entity.fields) {
    if (isStoredFieldType(f.fieldtype) && rows.some((r) => f.fieldname in r)) push(f.fieldname);
  }
  for (const r of rows) for (const k of Object.keys(r)) push(k);

  const records = rows.map((r) => {
    const rec: Record<string, string> = {};
    for (const c of cols) {
      const v = r[c];
      if (v == null) rec[c] = "";
      else if (typeof v === "object") rec[c] = JSON.stringify(v);
      else rec[c] = String(v);
    }
    return rec;
  });
  return stringify(records, { header: true, columns: cols });
}
