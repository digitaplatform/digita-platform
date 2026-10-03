/** A collection read excludes retained deleted records unless its trusted caller opts in. */
export function activeRecordsFilter(filter: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.keys(filter).length ? { $and: [filter, { deleted: null }] } : { deleted: null };
}

/** Apply the same read boundary to every collection a Mongo pipeline reads. */
export function activeRecordsPipeline(pipeline: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const stages = rewriteJoinedReads(pipeline);
  // These stages must remain first. Their document results are filtered before later stages.
  const first = stages[0];
  // Literal documents are not collection records; their nested collection reads are guarded above.
  if (first && "$documents" in first) return stages;
  for (const key of ["$search", "$vectorSearch"]) {
    const search = first?.[key] as Record<string, unknown> | undefined;
    // Stored search sources may omit the marker or lag behind the authoritative record.
    if (search?.["returnStoredSource"] === true) throw new Error("Stored search sources cannot enforce record deletion");
  }
  const search = first?.["$search"] as Record<string, unknown> | undefined;
  if (search && ("count" in search || "facet" in search)) {
    throw new Error("Search metadata cannot enforce record deletion");
  }
  if (search && ("vectorSearch" in search || "knnBeta" in search)) {
    throw new Error("Search vector operators cannot enforce record deletion before their result limit");
  }
  if (first?.["$geoNear"]) {
    const near = first["$geoNear"] as Record<string, unknown>;
    // Output fields can overwrite the audit marker, so filter the source records instead.
    stages[0] = { $geoNear: { ...near, query: activeRecordsFilter(near["query"] as Record<string, unknown> | undefined) } };
    return stages;
  }
  if (first?.["$vectorSearch"]) {
    const vector = first["$vectorSearch"] as Record<string, unknown>;
    const filter = vector["filter"] as Record<string, unknown> | undefined;
    // Vector prefilters distinguish missing fields from null. Negate the supported non-null
    // predicate so both active forms remain candidates before the search applies its limit.
    const active = { $nor: [{ deleted: { $ne: null } }] };
    stages[0] = { $vectorSearch: { ...vector, filter: filter ? { $and: [filter, active] } : active } };
  }
  if (first?.["$match"]) {
    stages[0] = { $match: activeRecordsFilter(first["$match"] as Record<string, unknown>) };
    return stages;
  }
  const index = first && ("$search" in first || "$vectorSearch" in first) ? 1 : 0;
  stages.splice(index, 0, { $match: activeRecordsFilter() });
  return stages;
}

function rewriteJoinedReads(pipeline: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return pipeline.map((stage) => {
    if ("$searchMeta" in stage || usesSearchMetadata(stage)) {
      throw new Error("Search metadata cannot enforce record deletion");
    }
    if (stage["$lookup"]) {
      const lookup = stage["$lookup"] as Record<string, unknown>;
      return { $lookup: { ...lookup, pipeline: activeRecordsPipeline((lookup["pipeline"] ?? []) as Record<string, unknown>[]) } };
    }
    if (stage["$graphLookup"]) {
      const lookup = stage["$graphLookup"] as Record<string, unknown>;
      return { $graphLookup: { ...lookup, restrictSearchWithMatch: activeRecordsFilter(lookup["restrictSearchWithMatch"] as Record<string, unknown> | undefined) } };
    }
    if (stage["$unionWith"]) {
      const union = typeof stage["$unionWith"] === "string" ? { coll: stage["$unionWith"] } : stage["$unionWith"] as Record<string, unknown>;
      return { $unionWith: { ...union, pipeline: activeRecordsPipeline((union["pipeline"] ?? []) as Record<string, unknown>[]) } };
    }
    if (stage["$facet"]) {
      const facet = stage["$facet"] as Record<string, Record<string, unknown>[]>;
      return { $facet: Object.fromEntries(Object.entries(facet).map(([name, stages]) => [name, rewriteJoinedReads(stages)])) };
    }
    return { ...stage };
  });
}

function expressionUsesSearchMetadata(value: unknown): boolean {
  if (typeof value === "string") return /^\$\$SEARCH_META(?:\.|$)/.test(value);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    key !== "$literal" && key !== "$const" && expressionUsesSearchMetadata(child));
}

function filterUsesSearchMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (key === "$expr") return expressionUsesSearchMetadata(child);
    if (["$and", "$or", "$nor"].includes(key)) return Array.isArray(child) && child.some(filterUsesSearchMetadata);
    return !key.startsWith("$") && fieldFilterUsesSearchMetadata(child);
  });
}

function fieldFilterUsesSearchMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const operators = value as Record<string, unknown>;
  // Comparison operands are literal values, including documents with dollar-prefixed keys.
  return filterUsesSearchMetadata(operators["$elemMatch"]) || fieldFilterUsesSearchMetadata(operators["$not"]);
}

function usesSearchMetadata(stage: Record<string, unknown>): boolean {
  if ("$match" in stage) return filterUsesSearchMetadata(stage["$match"]);
  if ("$lookup" in stage) return expressionUsesSearchMetadata((stage["$lookup"] as Record<string, unknown>)["let"]);
  if ("$graphLookup" in stage) {
    const lookup = stage["$graphLookup"] as Record<string, unknown>;
    return expressionUsesSearchMetadata(lookup["startWith"]) || filterUsesSearchMetadata(lookup["restrictSearchWithMatch"]);
  }
  if ("$geoNear" in stage) {
    const near = stage["$geoNear"] as Record<string, unknown>;
    return expressionUsesSearchMetadata(near["near"]) || filterUsesSearchMetadata(near["query"]);
  }
  for (const key of ["$bucket", "$bucketAuto", "$setWindowFields", "$fill"]) {
    if (key in stage) {
      const options = stage[key] as Record<string, unknown>;
      return expressionUsesSearchMetadata(options["groupBy"] ?? options["partitionBy"]) || expressionUsesSearchMetadata(options["output"]);
    }
  }
  // Joined/faceted pipelines are checked recursively. These other arguments are literals.
  if (["$search", "$vectorSearch", "$unionWith", "$facet", "$sort", "$unwind", "$unset", "$out", "$count"].some((key) => key in stage)) return false;
  return expressionUsesSearchMetadata(stage);
}
