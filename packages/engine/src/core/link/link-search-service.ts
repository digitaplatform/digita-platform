import { ROW_ID_FIELD } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { readStoredRow } from "../entity/field-types.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { applyScopeFilters } from "../permissions/scope-filter.js";
import { assertFieldAllowed, isFieldAllowed } from "../database/filter-builder.js";
import { env } from "../config/env.js";

export interface LinkSearchResult {
  _id: string;
  display: string;
  /**
   * Optional secondary line for the picker UI. Populated for sub-row
   * (`target_path`) results — the parent doc title — so the row can show
   * `parent.title — row.label`.
   */
  subtitle?: string;
  /**
   * Column values for the search-dialog picker — the requested `columns` (or the
   * target entity's `search_fields` by default). Absent for the plain dropdown.
   */
  fields?: Record<string, unknown>;
}

/**
 * Search for documents to show in Link field dropdowns.
 *
 * Two modes:
 *   **Direct**: search documents on `targetEntity` by their `search_fields`,
 *     return flat `{_id, display}` rows. This is the default `Link` field flow.
 *   **Sub-row** (`target_path` set): search parent docs on `targetEntity`,
 *     expand each into one row per element of `parent[<target_path>]`, return
 *     composite `_id = "<parent_id>::<_row_id>"`. This drives the picker for
 *     `target_path` Links — e.g. picking a specific address out of a
 *     customer's `addresses[]` Table.
 */
export class LinkSearchService {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
    private permissionChecker: PermissionChecker,
  ) {}

  async search(
    targetEntity: string,
    query: string,
    user: UserContext,
    filters?: Record<string, unknown>,
    limit: number = 20,
    targetPath?: string,
    columns?: string[],
  ): Promise<LinkSearchResult[]> {
    // Same gate as getList: no select permission on the target → no typeahead
    // enumeration. Sub-row mode checks the PARENT entity (its rows carry the data).
    await this.permissionChecker.check(user, targetEntity, "select");

    if (targetPath) return this.searchSubRow(targetEntity, query, user, filters, limit, targetPath);

    const entity = this.registry.get(targetEntity);
    const displayField = entity.title_field ?? "_id";
    const { allowed, gatesRows, masksStoredRows } = this.readScope(user, targetEntity, filters);
    const searchFields = this.searchableFields(entity.search_fields ?? [displayField], displayField, allowed);
    // Extra column values requested by the search-dialog picker. Returned ONLY
    // when explicitly asked for, so the plain dropdown stays {_id, display}.
    // Matching itself always uses search_fields, regardless of columns.
    // Requested columns are constrained to real entity fields — the query
    // string is user-controlled and must not become a free projection.
    const knownFields = new Set(entity.fields.map((f) => f.fieldname));
    const requestedCols = columns?.filter((c) => knownFields.has(c));
    const cols = requestedCols && requestedCols.length > 0 ? requestedCols : undefined;

    const searchConditions = searchFields.map((field) => ({
      [field]: { $regex: this.escapeRegex(query), $options: "i" },
    }));

    let mongoFilter: Record<string, unknown> = {};

    if (searchConditions.length > 0) {
      mongoFilter["$or"] = searchConditions;
    }

    if (filters) {
      Object.assign(mongoFilter, filters);
    }

    // Scope narrowing (if_owner / permission.scope) — same semantics as getList.
    mongoFilter = applyScopeFilters(entity, user, mongoFilter, env.PERMISSION_SCOPE_ENABLED);

    const fetchFields = cols
      ? Array.from(new Set(["_id", displayField, ...cols]))
      : ["_id", displayField];
    const docs = await this.db.find(
      targetEntity,
      {
        filters: Object.keys(mongoFilter).length > 0 ? [mongoFilter] : [],
        fields: masksStoredRows ? undefined : fetchFields,
        limit,
        order_by: `${displayField} asc`,
      },
      entity.database,
    );

    // ponytail: rows a read condition hides are dropped after the query, so the
    // page is short by them; fetch past them if a picker ever needs its full limit.
    const out: LinkSearchResult[] = [];
    for (const doc of (docs as Record<string, unknown>[]).map((row) => readStoredRow(entity, row))) {
      if (gatesRows && !(await this.permissionChecker.hasPermission(user, targetEntity, "read", doc)).allowed) continue;
      const result: LinkSearchResult = {
        _id: String(doc["_id"]),
        display: String(doc[displayField] ?? doc["_id"]),
      };
      if (cols) {
        // Field-level read permissions (perm_level) apply to picker columns too,
        // decided on the stored row: a condition reads fields the columns lack.
        const readable = this.permissionChecker.filterFieldsForRead(user, targetEntity, {
          ...Object.fromEntries(cols.map((c) => [c, null])),
          ...doc,
        });
        result.fields = Object.fromEntries(cols.filter((c) => c in readable).map((c) => [c, readable[c]]));
      }
      out.push(result);
    }
    return out;
  }

  /**
   * What a search of `user` on `entityName` may name and must re-check, as getList
   * does: `filters` keys only from the fields the user may filter on (else
   * FilterFieldNotAllowedError), rows a read condition hides dropped per stored row,
   * and fields masked on the stored row whenever a grant's owner, condition or scope
   * decides them.
   */
  private readScope(
    user: UserContext,
    entityName: string,
    filters: Record<string, unknown> | undefined,
  ): { allowed: Set<string>; gatesRows: boolean; masksStoredRows: boolean } {
    const allowed = this.permissionChecker.getFilterAllowlist(user, entityName);
    for (const key of Object.keys(filters ?? {})) assertFieldAllowed(key, allowed);
    const gatesRows = this.permissionChecker.hasConditionalRowRead(user, entityName);
    const masksStoredRows = gatesRows || this.permissionChecker.hasRowDependentRead(user, entityName);
    return { allowed, gatesRows, masksStoredRows };
  }

  /** The search fields a query may match on: those the user may filter on, and the
   *  display field, which the result shows anyway. */
  private searchableFields(searchFields: string[], displayField: string, allowed: Set<string>): string[] {
    return searchFields.filter((field) => field === displayField || isFieldAllowed(field, allowed));
  }

  /**
   * Search parents and expand into row-level results. Each parent's matching
   * `<target_path>[]` rows become individual results with a composite `_id`
   * that the resolver/validator can split back into parent + row.
   *
   * Search semantics:
   *   Parent doc must match the query against its own `search_fields` OR
   *     against any string field in any of its `target_path` rows. This way
   *     typing a city name surfaces a customer whose city sits in a row, not
   *     the customer's main fields.
   *   Limit is applied at the row level (not parent level) — typing into a
   *     short query that broad-matches one big customer with 200 addresses
   *     returns up to `limit` of those rows, not 200.
   */
  private async searchSubRow(
    targetEntity: string,
    query: string,
    user: UserContext,
    filters: Record<string, unknown> | undefined,
    limit: number,
    targetPath: string,
  ): Promise<LinkSearchResult[]> {
    const entity = this.registry.get(targetEntity);
    const displayField = entity.title_field ?? "_id";
    const tableField = entity.fields.find((f) => f.fieldname === targetPath);
    if (!tableField || tableField.fieldtype !== "Table" || !tableField.child_fields) {
      return [];
    }

    const { allowed, gatesRows, masksStoredRows } = this.readScope(user, targetEntity, filters);
    const escaped = this.escapeRegex(query);
    const parentSearch = this.searchableFields(entity.search_fields ?? [displayField], displayField, allowed).map((f) => ({
      [f]: { $regex: escaped, $options: "i" },
    }));
    const childTextFields = tableField.child_fields
      .filter((c) => c.fieldtype === "Data" || c.fieldtype === "Text")
      .filter((c) => isFieldAllowed(`${targetPath}.${c.fieldname}`, allowed))
      .map((c) => ({
        [`${targetPath}.${c.fieldname}`]: { $regex: escaped, $options: "i" },
      }));
    const orConditions = [...parentSearch, ...childTextFields];
    let mongoFilter: Record<string, unknown> = {};
    if (orConditions.length > 0) mongoFilter["$or"] = orConditions;
    if (filters) Object.assign(mongoFilter, filters);
    // Scope narrowing applies to the parent docs whose rows get expanded.
    mongoFilter = applyScopeFilters(entity, user, mongoFilter, env.PERMISSION_SCOPE_ENABLED);

    const docs = await this.db.find(
      targetEntity,
      {
        filters: Object.keys(mongoFilter).length > 0 ? [mongoFilter] : [],
        // Pull the parent's display + the entire table — we need every row to
        // expand. The result row count caps at `limit` anyway.
        fields: masksStoredRows ? undefined : ["_id", displayField, targetPath],
        limit, // parents fetched
        order_by: `${displayField} asc`,
      },
      entity.database,
    );

    const childTitleField =
      tableField.child_fields.find((c) => c.fieldtype === "Data")?.fieldname ??
      tableField.child_fields[0]?.fieldname ??
      "_row_id";

    const out: LinkSearchResult[] = [];
    for (const doc of docs as Record<string, unknown>[]) {
      if (gatesRows && !(await this.permissionChecker.hasPermission(user, targetEntity, "read", doc)).allowed) continue;
      // The rows are the parent's content: masked on the stored parent like a
      // read of it, so a row label is never a child field the user may not read.
      const readable = this.permissionChecker.filterFieldsForRead(user, targetEntity, doc);
      const rows = readable[targetPath] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(rows)) continue;
      const parentDisplay = String(doc[displayField] ?? doc["_id"]);
      for (const row of rows) {
        const rowId = row[ROW_ID_FIELD];
        if (typeof rowId !== "string" || !rowId) continue;
        const rowLabel = String(row[childTitleField] ?? rowId);
        out.push({
          _id: `${String(doc["_id"])}::${rowId}`,
          display: rowLabel,
          subtitle: parentDisplay,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
