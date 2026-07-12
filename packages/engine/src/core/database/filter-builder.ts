import type { Filter, Document } from "mongodb";

export type FilterTuple = [string, string, unknown];

/**
 * A caller-supplied filter names a field that is not on the entity's declared
 * surface (or is a `$`-prefixed Mongo operator in the KEY position). Thrown by
 * buildMongoFilter when an allow-list is supplied; the global error handler maps
 * it to 400. Blocks anonymous/external NoSQL operator injection (`$where`/`$expr`/
 * `$function`) reachable via the public + resource list endpoints (P-SEC/R7).
 */
export class FilterFieldNotAllowedError extends Error {
  constructor(public readonly field: string) {
    super(`Filter field not allowed: ${field}`);
    this.name = "FilterFieldNotAllowedError";
  }
}

/** Reject an operator key ($…) or a field whose root segment the entity did not
 *  declare. No-op when no allow-list is supplied (internal callers / legacy).
 *  Exported so the count path (object-form filters) can validate its keys with
 *  the exact same rule as the list path (P-SEC/R7). */
export function assertFieldAllowed(field: string, allowedFields?: Set<string>): void {
  if (!allowedFields) return;
  if (typeof field !== "string" || field.startsWith("$") || !allowedFields.has(field.split(".")[0]!)) {
    throw new FilterFieldNotAllowedError(String(field));
  }
}

export interface ListQuery {
  fields?: string[];
  filters?: FilterTuple[];
  or_filters?: FilterTuple[];
  order_by?: string;
  limit?: number;
  offset?: number;
  page?: number;
  page_size?: number;
  search?: string;
}

/**
 * Build a MongoDB filter from API query parameters.
 * Supports AND filters, OR filters, and text search.
 */
export function buildMongoFilter(
  query: ListQuery,
  searchFields?: string[],
  /** When supplied, every filter/or_filter field name is checked against this set
   *  (root segment for dotted paths) and `$`-prefixed keys are rejected — P-SEC/R7.
   *  Omit for trusted/internal callers to keep the legacy unrestricted behaviour. */
  allowedFields?: Set<string>,
): Filter<Document> {
  const conditions: Filter<Document>[] = [];

  // AND filters
  if (query.filters?.length) {
    for (const [field, operator, value] of query.filters) {
      assertFieldAllowed(field, allowedFields);
      conditions.push({ [field]: mapOperatorToMongo(operator, value) } as Filter<Document>);
    }
  }

  // OR filters
  if (query.or_filters?.length) {
    const orConditions = query.or_filters.map(([field, operator, value]) => {
      assertFieldAllowed(field, allowedFields);
      return { [field]: mapOperatorToMongo(operator, value) };
    });
    conditions.push({ $or: orConditions } as Filter<Document>);
  }

  // Text search
  if (query.search && searchFields?.length) {
    const searchConditions = searchFields.map((field) => ({
      [field]: { $regex: escapeRegex(query.search!), $options: "i" },
    }));
    conditions.push({ $or: searchConditions } as Filter<Document>);
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0]!;
  return { $and: conditions } as Filter<Document>;
}


/**
 * Build MongoDB sort from order_by string.
 */
export function buildSort(orderBy?: string): Record<string, 1 | -1> | undefined {
  if (!orderBy) return undefined;

  const sort: Record<string, 1 | -1> = {};
  const parts = orderBy.split(",").map((p) => p.trim());

  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const field = tokens[0];
    const direction = tokens[1]?.toLowerCase();
    if (field) {
      sort[field] = direction === "desc" ? -1 : 1;
    }
  }

  return sort;
}

/**
 * Parse pagination from query params.
 *
 * Precedence (first match wins):
 *   1. explicit `limit` / `offset` → honour both.
 *   2. `page_size` set (with or without `page`) → compute offset from
 *      page-1 (defaults to page 1).
 *   3. defaults: limit=20, offset=0.
 */
export function parsePagination(query: ListQuery): { limit: number; offset: number } {
  // page + page_size is the highest-precedence pair — matches the
  // documented API and keeps existing callers working.
  if (query.page !== undefined && query.page_size !== undefined) {
    return {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    };
  }
  // page_size alone: implicit page 1, full size honoured.
  if (query.page_size !== undefined) {
    return { limit: query.page_size, offset: query.offset ?? 0 };
  }
  return {
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
  };
}

function mapOperatorToMongo(operator: string, value: unknown): unknown {
  switch (operator) {
    case "=":
    case "==":
      return value;
    case "!=":
    case "<>":
      return { $ne: value };
    case ">":
      return { $gt: value };
    case ">=":
      return { $gte: value };
    case "<":
      return { $lt: value };
    case "<=":
      return { $lte: value };
    case "in":
      return { $in: value };
    case "not in":
      return { $nin: value };
    case "like":
      return { $regex: likeToRegex(value as string), $options: "i" };
    case "not like":
      return { $not: { $regex: likeToRegex(value as string), $options: "i" } };
    case "between": {
      const arr = value as [unknown, unknown];
      return { $gte: arr[0], $lte: arr[1] };
    }
    case "is":
      if (value === "set" || value === "not null") return { $ne: null };
      if (value === "not set" || value === "null") return null;
      return value;
    case "regex":
      return { $regex: safeUserRegex(value), $options: "i" };
    case "exists":
      return { $exists: value };
    default:
      return value;
  }
}

function likeToRegex(pattern: string): string {
  return escapeRegex(pattern).replace(/%/g, ".*").replace(/_/g, ".");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MAX_REGEX_LENGTH = 256;

/**
 * Guard a user-supplied `regex` filter value against ReDoS (S-4): it must be a
 * short string with no nested quantifiers — the classic catastrophic-
 * backtracking shape like `(a+)+`, `(a*)*`, `(.*)*`.
 */
export function safeUserRegex(value: unknown): string {
  if (typeof value !== "string") throw new Error("regex filter value must be a string");
  if (value.length > MAX_REGEX_LENGTH) {
    throw new Error(`regex filter too long (max ${MAX_REGEX_LENGTH} chars)`);
  }
  if (/\([^)]*[+*][^)]*\)\s*[+*]/.test(value)) {
    throw new Error("regex filter rejected (potential ReDoS: nested quantifiers)");
  }
  return value;
}
