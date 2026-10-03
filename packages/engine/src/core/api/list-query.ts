import type { ListQuery } from "../database/filter-builder.js";
import { BadRequestError } from "../view/view-engine.js";

/**
 * The ListQuery a list route reads from its query string. `fields`, `filters` and
 * `or_filters` travel as JSON; a value that is not JSON is the caller's mistake and
 * answers 400, never a crash of the route.
 */
export function listQueryFrom(query: Record<string, unknown>): ListQuery {
  return {
    fields: jsonParam(query, "fields") as ListQuery["fields"],
    filters: filterTuplesParam(query, "filters"),
    or_filters: filterTuplesParam(query, "or_filters"),
    order_by: oneStringParam(query, "order_by"),
    limit: wholeNumberParam(query, "limit", 1),
    offset: wholeNumberParam(query, "offset", 0),
    page: wholeNumberParam(query, "page", 1),
    page_size: wholeNumberParam(query, "page_size", 1),
    search: oneStringParam(query, "search"),
  };
}

/** A count or a position: a whole number from `min` up. A list without a valid limit would read
 *  every row, since the database reads a missing limit as none. */
export function wholeNumberParam(query: Record<string, unknown>, name: string, min: number): number | undefined {
  const raw = query[name];
  if (raw === undefined || raw === "") return undefined;
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new BadRequestError("param_not_whole_number", { param: name, min: String(min) });
  }
  return value;
}

function oneStringParam(query: Record<string, unknown>, name: string): string | undefined {
  const raw = query[name];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new BadRequestError("param_given_twice", { param: name });
  return raw;
}

function filterTuplesParam(query: Record<string, unknown>, name: string): ListQuery["filters"] {
  const value = jsonParam(query, name);
  if (value === undefined) return undefined;
  const isTuple = (t: unknown) => Array.isArray(t) && t.length === 3 && typeof t[0] === "string" && typeof t[1] === "string";
  if (!Array.isArray(value) || !value.every(isTuple)) {
    throw new BadRequestError("param_not_filter_list", { param: name });
  }
  return value as ListQuery["filters"];
}

export function jsonParam(query: Record<string, unknown>, name: string): unknown {
  const raw = query[name];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw as string);
  } catch {
    throw new BadRequestError("param_not_json", { param: name });
  }
}
