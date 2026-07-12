import type { EntityRegistry } from "../../entity/entity-registry.js";

/**
 * Walks a validated aggregation pipeline and collects every field reference
 * (entity-qualified). Used by `runAggregateSection` to enforce per-field
 * `perm_level` masking — pipelines that reference a protected field on an
 * entity the caller cannot read at that level are rejected.
 *
 * Reference shape:
 *   Source ref: a string starting with `$` matching `$<word>(.<path>)*`,
 *     e.g. `"$lines.product"` (records the leading segment, `lines`).
 *   Output ref: a key in `$project`, `$group` (other than `_id`),
 *     `$addFields`, `$set`. Recorded against the active context entity.
 *
 * Skipped:
 *   System variables: `$$ROOT`, `$$NOW`, `$$REMOVE`, `$$CURRENT`.
 *   Param-resolver tokens: `$root.x`, `$user.x`, `$param.x`.
 *   Mongo expression operators (`$multiply`, `$first`, `$cond`, etc.) —
 *     keys starting with `$` and matching one of the operator names just
 *     descend into their arguments. The walker treats them as plumbing,
 *     not field refs.
 *
 * Context entity tracking:
 *   Top-level pipeline runs against `rootEntity`.
 *   Inside `$lookup.pipeline`, the active context entity is `lookup.from`.
 *   `$facet` branches reset to sibling pipelines against the parent context.
 */

export interface FieldReference {
  entity: string;
  field: string;
  origin: "source" | "output";
}

const RESERVED_TOKEN_PREFIXES = ["$root.", "$user.", "$param.", "$now"];

/**
 * Mongo aggregation operator names. Keys with these names inside a stage
 * body are NOT field references — they're plumbing. We only descend through
 * their values.
 */
const MONGO_OPERATORS = new Set<string>([
  // Arithmetic
  "$add",
  "$subtract",
  "$multiply",
  "$divide",
  "$mod",
  "$abs",
  // Accumulators
  "$sum",
  "$avg",
  "$min",
  "$max",
  "$first",
  "$last",
  "$push",
  "$addToSet",
  "$count",
  // Comparison
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$cmp",
  // Logical / cond
  "$and",
  "$or",
  "$not",
  "$cond",
  "$ifNull",
  "$switch",
  "$case",
  // Array
  "$arrayElemAt",
  "$concatArrays",
  "$filter",
  "$map",
  "$reduce",
  "$size",
  "$slice",
  "$in",
  "$indexOfArray",
  // String
  "$concat",
  "$toLower",
  "$toUpper",
  "$substr",
  "$substrCP",
  "$strLenCP",
  "$split",
  "$trim",
  "$replaceAll",
  "$replaceOne",
  // Date
  "$year",
  "$month",
  "$dayOfMonth",
  "$dayOfWeek",
  "$dayOfYear",
  "$hour",
  "$minute",
  "$second",
  "$millisecond",
  "$dateToString",
  "$dateFromString",
  // Conversions
  "$toString",
  "$toInt",
  "$toLong",
  "$toDouble",
  "$toDate",
  "$toBool",
  // Stages-level (also appear as keys in stage bodies sometimes)
  "$expr",
  "$exists",
  "$elemMatch",
  "$regex",
  "$options",
  "$type",
  "$all",
  "$nin",
  "$mod",
  "$literal",
  "$let",
  "$mergeObjects",
  "$objectToArray",
  "$arrayToObject",
]);

/** Stage-level operators encountered as `pipeline[].$<stage>`. */
const STAGE_OPERATORS = new Set<string>([
  "$match",
  "$project",
  "$group",
  "$addFields",
  "$set",
  "$unwind",
  "$sort",
  "$limit",
  "$skip",
  "$lookup",
  "$facet",
  "$count",
  "$replaceRoot",
  "$replaceWith",
]);

/**
 * Walk the pipeline and produce flat refs.
 */
export function collectFieldReferences(
  pipeline: unknown,
  rootEntity: string,
  registry: EntityRegistry,
): FieldReference[] {
  const out: FieldReference[] = [];
  if (!Array.isArray(pipeline)) return out;
  for (const stage of pipeline) {
    walkStage(stage, rootEntity, registry, out);
  }
  return out;
}

function walkStage(
  stage: unknown,
  contextEntity: string,
  registry: EntityRegistry,
  out: FieldReference[],
): void {
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) return;
  const obj = stage as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return; // malformed stage — let validator reject

  const stageKey = keys[0]!;
  const body = obj[stageKey];

  switch (stageKey) {
    case "$match":
      walkExpr(body, contextEntity, out);
      return;
    case "$project":
    case "$addFields":
    case "$set":
      if (body && typeof body === "object") {
        for (const [k, v] of Object.entries(body)) {
          recordOutput(contextEntity, k, out);
          walkExpr(v, contextEntity, out);
        }
      }
      return;
    case "$group":
      if (body && typeof body === "object") {
        const groupBody = body as Record<string, unknown>;
        if ("_id" in groupBody) walkExpr(groupBody["_id"], contextEntity, out);
        for (const [k, v] of Object.entries(groupBody)) {
          if (k === "_id") continue;
          recordOutput(contextEntity, k, out);
          walkExpr(v, contextEntity, out);
        }
      }
      return;
    case "$unwind":
      walkExpr(body, contextEntity, out);
      return;
    case "$sort":
      if (body && typeof body === "object") {
        for (const k of Object.keys(body)) recordSource(contextEntity, k, out);
      }
      return;
    case "$lookup":
      if (body && typeof body === "object") {
        const lookup = body as Record<string, unknown>;
        const from = lookup["from"];
        const localField = lookup["localField"];
        const foreignField = lookup["foreignField"];
        const subPipeline = lookup["pipeline"];
        const as = lookup["as"];
        if (typeof localField === "string") recordSource(contextEntity, localField, out);
        if (typeof from === "string" && typeof foreignField === "string") {
          recordSource(from, foreignField, out);
        }
        if (typeof as === "string") recordOutput(contextEntity, as, out);
        if (Array.isArray(subPipeline) && typeof from === "string") {
          for (const child of subPipeline) walkStage(child, from, registry, out);
        }
      }
      return;
    case "$facet":
      if (body && typeof body === "object") {
        for (const childPipe of Object.values(body)) {
          if (Array.isArray(childPipe)) {
            for (const child of childPipe) walkStage(child, contextEntity, registry, out);
          }
        }
      }
      return;
    case "$replaceRoot":
    case "$replaceWith":
      walkExpr(body, contextEntity, out);
      return;
    default:
      // Unknown stage — view-validator should already reject. Ignore here.
      return;
  }
}

/**
 * Walk a Mongo expression tree, recording any leaf that's a field reference
 * (`$<segment>...`). Operator keys like `$multiply` aren't refs; their values
 * are descended.
 */
function walkExpr(node: unknown, contextEntity: string, out: FieldReference[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walkExpr(child, contextEntity, out);
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith("$")) {
        if (MONGO_OPERATORS.has(k) || STAGE_OPERATORS.has(k)) {
          walkExpr(v, contextEntity, out);
        } else {
          // Unknown $-prefixed key in expr context — leave alone.
          walkExpr(v, contextEntity, out);
        }
      } else {
        // Plain field key in $match: { customer: "X" }
        recordSource(contextEntity, k, out);
        walkExpr(v, contextEntity, out);
      }
    }
    return;
  }
  if (typeof node === "string") {
    recordIfFieldRef(node, contextEntity, out);
  }
}

function recordIfFieldRef(s: string, contextEntity: string, out: FieldReference[]): void {
  if (!s.startsWith("$")) return;
  if (s.startsWith("$$")) return; // system variable
  // Skip param-resolver tokens (already substituted earlier) — defensive.
  for (const p of RESERVED_TOKEN_PREFIXES) {
    if (s.startsWith(p) || s === "$now") return;
  }
  // Reject operator-named bare strings ("$first" by itself).
  if (MONGO_OPERATORS.has(s) || STAGE_OPERATORS.has(s)) return;
  // Extract the leading segment after `$`.
  const m = s.match(/^\$([a-zA-Z_][\w]*)(?:\.[\w.]+)?$/);
  if (!m) return;
  const fieldName = m[1]!;
  recordSource(contextEntity, fieldName, out);
}

function recordSource(entity: string, field: string, out: FieldReference[]): void {
  if (!field) return;
  out.push({ entity, field, origin: "source" });
}

function recordOutput(entity: string, field: string, out: FieldReference[]): void {
  if (!field || field.startsWith("_")) return;
  out.push({ entity, field, origin: "output" });
}
