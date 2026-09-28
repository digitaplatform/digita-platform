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
    filters: jsonParam(query, "filters") as ListQuery["filters"],
    or_filters: jsonParam(query, "or_filters") as ListQuery["or_filters"],
    order_by: query["order_by"] as string,
    limit: query["limit"] ? Number(query["limit"]) : undefined,
    offset: query["offset"] ? Number(query["offset"]) : undefined,
    page: query["page"] ? Number(query["page"]) : undefined,
    page_size: query["page_size"] ? Number(query["page_size"]) : undefined,
    search: query["search"] as string,
  };
}

function jsonParam(query: Record<string, unknown>, name: string): unknown {
  const raw = query[name];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw as string);
  } catch {
    throw new BadRequestError(`${name} is not JSON`);
  }
}
