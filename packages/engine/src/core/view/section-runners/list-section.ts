import type { ListSection, ViewFilterTuple } from "@digitaplatform/shared";
import type { DocumentService } from "../../document/document-service.js";
import type { UserContext } from "../../permissions/types.js";
import type { ResponseContext } from "../../api/response-context.js";
import type { ListQuery, FilterTuple } from "../../database/filter-builder.js";
import { resolveTokens, type ResolverContext } from "../param-resolver.js";

export interface ListRunnerDeps {
  documentService: DocumentService;
}

/**
 * Resolve a 1:n / n:m section by delegating to `DocumentService.getList`.
 * Permissions, scope filters, if_owner, and field-level read masking all run
 * inside getList — the runner just shapes the ListQuery from declarative input
 * and (optionally) batch-fetches an `expand` link.
 */
export async function runListSection(
  section: ListSection,
  rctx: ResolverContext,
  user: UserContext,
  ctx: ResponseContext,
  deps: ListRunnerDeps,
  defaultLimit?: number,
  maxLimit?: number,
): Promise<Record<string, unknown>[]> {
  // Resolve tokens inside filter tuples and other dynamic fields.
  const resolved = resolveTokens(section, rctx) as ListSection;

  const filters = (resolved.filter ?? [])
    .map((t) => normaliseFilterTuple(t))
    .filter((t): t is FilterTuple => t !== null);
  const orFilters = (resolved.or_filter ?? [])
    .map((t) => normaliseFilterTuple(t))
    .filter((t): t is FilterTuple => t !== null);

  let limit = resolved.limit ?? defaultLimit ?? 20;
  if (maxLimit && limit > maxLimit) limit = maxLimit;

  const query: ListQuery = {
    filters,
    or_filters: orFilters,
    order_by: resolved.order_by,
    limit,
    offset: resolved.offset,
    fields: resolved.fields,
    search: resolved.search,
  };

  const result = await deps.documentService.getList(section.entity, query, user, ctx);
  let rows = result.data;

  // Optional one-hop expand: batch-load foreign docs by `_id in [...]`.
  if (section.expand && rows.length) {
    rows = await applyExpand(rows, section, user, ctx, deps);
  }

  return rows;
}

function normaliseFilterTuple(t: ViewFilterTuple): FilterTuple | null {
  if (!Array.isArray(t) || t.length !== 3) return null;
  const [field, op, value] = t;
  if (typeof field !== "string" || typeof op !== "string") return null;
  return [field, op, value];
}

async function applyExpand(
  rows: Record<string, unknown>[],
  section: ListSection,
  user: UserContext,
  ctx: ResponseContext,
  deps: ListRunnerDeps,
): Promise<Record<string, unknown>[]> {
  const exp = section.expand!;
  const ids = Array.from(
    new Set(
      rows
        .map((r) => r[exp.field])
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  if (ids.length === 0) return rows;

  const expanded = await deps.documentService.getList(
    exp.entity,
    {
      filters: [["_id", "in", ids]],
      fields: exp.fields,
      limit: ids.length,
    },
    user,
    ctx,
  );
  const byId = new Map(expanded.data.map((d) => [String(d["_id"]), d]));

  const property = exp.as ?? `${exp.field}_doc`;
  return rows.map((r) => {
    const key = r[exp.field];
    const linked = typeof key === "string" ? byId.get(key) : undefined;
    return { ...r, [property]: linked ?? null };
  });
}
