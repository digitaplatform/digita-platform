import type { EntityRegistry } from "../../entity/entity-registry.js";

/**
 * Walks a validated aggregation pipeline and collects every field reference
 * (entity-qualified). Used by `runAggregateSection` to enforce per-field
 * `perm_level` masking — pipelines that reference a protected field on an
 * entity the caller cannot read at that level are rejected.
 *
 * Reference shape:
 *   Source ref: a name a stage reads as a field of the entity: a `$<name>` string in an
 *     expression, a plain key of `$match`, a `$sort` key, `$lookup.localField` (the leading
 *     segment is recorded). `$$ROOT` / `$$CURRENT` record `WHOLE_DOCUMENT`.
 *   Output ref: a key in `$project`, `$group` (other than `_id`), `$addFields`, `$set` and
 *     `$lookup.as`. Recorded against the active context entity.
 *
 * Not field references:
 *   A name an earlier stage of the same pipeline produced, and every name after a stage that
 *     replaced the documents ($group, $project, $count, $replaceRoot, $replaceWith, $facet).
 *   A plain key inside an expression: an output name ($group's object `_id`) or a named
 *     argument of an operator (`format`, `date`, `if`, `then`, `input`).
 *   Variables: `$$NOW`, `$$REMOVE` and the names $let, $map and $filter bind.
 *   Param-resolver tokens: `$root.x`, `$user.x`, `$param.x`.
 *
 * Context entity tracking:
 *   Top-level pipeline runs against `rootEntity`.
 *   Inside `$lookup.pipeline`, the active context entity is `lookup.from`.
 *   `$facet` branches walk sibling pipelines against the parent context.
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
 * The field a reference to the whole current document stands for: `$$ROOT` or `$$CURRENT`
 * before the first reshaping stage hands every field of the entity on.
 */
export const WHOLE_DOCUMENT = "*";

/**
 * What a stage of one pipeline sees: the entity whose fields a name means, the names earlier
 * stages produced, and whether a reshaping stage ($group, $project, $count, $replaceRoot,
 * $replaceWith, $facet) has replaced the documents, after which no name means an entity field.
 */
interface WalkState {
  entity: string;
  produced: Set<string>;
  reshaped: boolean;
}

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
  walkPipeline(pipeline, { entity: rootEntity, produced: new Set(), reshaped: false }, registry, out);
  return out;
}

function walkPipeline(pipeline: unknown[], state: WalkState, registry: EntityRegistry, out: FieldReference[]): void {
  for (const stage of pipeline) walkStage(stage, state, registry, out);
}

function walkStage(
  stage: unknown,
  state: WalkState,
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
      walkQuery(body, state, out);
      return;
    case "$project":
    case "$addFields":
    case "$set":
      if (body && typeof body === "object") {
        for (const [k, v] of Object.entries(body)) {
          if (!state.produced.has(k) && !state.reshaped) recordOutput(state.entity, k, out);
          walkExpr(v, state, out);
        }
        for (const k of Object.keys(body)) state.produced.add(k);
        if (stageKey === "$project") state.reshaped = true;
      }
      return;
    case "$group":
      if (body && typeof body === "object") {
        const groupBody = body as Record<string, unknown>;
        if ("_id" in groupBody) walkExpr(groupBody["_id"], state, out);
        for (const [k, v] of Object.entries(groupBody)) {
          if (k === "_id") continue;
          if (!state.produced.has(k) && !state.reshaped) recordOutput(state.entity, k, out);
          walkExpr(v, state, out);
        }
        for (const k of Object.keys(groupBody)) state.produced.add(k);
        state.reshaped = true;
      }
      return;
    case "$unwind":
      if (typeof body === "string") walkExpr(body, state, out);
      else if (body && typeof body === "object") {
        const unwind = body as Record<string, unknown>;
        walkExpr(unwind["path"], state, out);
        if (typeof unwind["includeArrayIndex"] === "string") state.produced.add(unwind["includeArrayIndex"]);
      }
      return;
    case "$sort":
      if (body && typeof body === "object") {
        for (const k of Object.keys(body)) recordName(state, k, out);
      }
      return;
    case "$count":
      if (typeof body === "string") state.produced.add(body);
      state.reshaped = true;
      return;
    case "$lookup":
      if (body && typeof body === "object") {
        const lookup = body as Record<string, unknown>;
        const from = lookup["from"];
        const localField = lookup["localField"];
        const foreignField = lookup["foreignField"];
        const subPipeline = lookup["pipeline"];
        const as = lookup["as"];
        if (typeof localField === "string") recordName(state, localField, out);
        if (typeof from === "string" && typeof foreignField === "string") {
          recordSource(from, foreignField, out);
        }
        if (typeof as === "string" && !state.produced.has(as) && !state.reshaped) recordOutput(state.entity, as, out);
        if (Array.isArray(subPipeline) && typeof from === "string") {
          walkPipeline(subPipeline, { entity: from, produced: new Set(), reshaped: false }, registry, out);
        }
        if (typeof as === "string") state.produced.add(as);
      }
      return;
    case "$facet":
      if (body && typeof body === "object") {
        for (const childPipe of Object.values(body)) {
          if (Array.isArray(childPipe)) {
            walkPipeline(childPipe, { entity: state.entity, produced: new Set(state.produced), reshaped: state.reshaped }, registry, out);
          }
        }
        for (const k of Object.keys(body)) state.produced.add(k);
        state.reshaped = true;
      }
      return;
    case "$replaceRoot":
    case "$replaceWith":
      walkExpr(body, state, out);
      state.reshaped = true;
      return;
    default:
      // Unknown stage — view-validator should already reject. Ignore here.
      return;
  }
}

/**
 * Walk a $match body, the query language: a plain key names a field of the documents, and the
 * logical operators hold further queries. `$expr` holds an aggregation expression.
 */
function walkQuery(node: unknown, state: WalkState, out: FieldReference[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkQuery(child, state, out);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "$and" || k === "$or" || k === "$nor") walkQuery(v, state, out);
    else if (k === "$expr") walkExpr(v, state, out);
    else if (k.startsWith("$")) walkExpr(v, state, out);
    else {
      recordName(state, k, out);
      walkExpr(v, state, out);
    }
  }
}

/**
 * Walk an aggregation expression. A string `$<name>` reads a field; a key that starts with `$`
 * is an operator whose value is walked; any other key is an output name or a named argument
 * of an operator ($group's object _id, `format` and `date` of $dateToString, `if` of $cond),
 * never a field.
 */
function walkExpr(node: unknown, state: WalkState, out: FieldReference[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walkExpr(child, state, out);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) walkExpr(v, state, out);
    return;
  }
  if (typeof node === "string") recordIfFieldRef(node, state, out);
}

function recordIfFieldRef(s: string, state: WalkState, out: FieldReference[]): void {
  if (!s.startsWith("$")) return;
  if (s.startsWith("$$")) {
    // The whole current document hands on every field until a stage reshapes it; other
    // variables ($$NOW, $$REMOVE, a $let or $map name) read no field of the entity.
    const m = s.match(/^\$\$(ROOT|CURRENT)(?:\.([a-zA-Z_][\w]*)[\w.]*)?$/);
    if (m && !state.reshaped) {
      if (m[2]) recordName(state, m[2], out);
      else recordSource(state.entity, WHOLE_DOCUMENT, out);
    }
    return;
  }
  // Skip param-resolver tokens (already substituted earlier) — defensive.
  for (const p of RESERVED_TOKEN_PREFIXES) {
    if (s.startsWith(p) || s === "$now") return;
  }
  // Reject operator-named bare strings ("$first" by itself).
  if (MONGO_OPERATORS.has(s) || STAGE_OPERATORS.has(s)) return;
  // Extract the leading segment after `$`.
  const m = s.match(/^\$([a-zA-Z_][\w]*)(?:\.[\w.]+)?$/);
  if (!m) return;
  recordName(state, m[1]!, out);
}

/** A name a stage reads: a field of the entity, unless an earlier stage produced it or replaced the documents. */
function recordName(state: WalkState, name: string, out: FieldReference[]): void {
  const leading = name.split(".")[0]!;
  if (state.produced.has(leading) || state.reshaped) return;
  recordSource(state.entity, leading, out);
}

function recordSource(entity: string, field: string, out: FieldReference[]): void {
  if (!field) return;
  out.push({ entity, field, origin: "source" });
}

function recordOutput(entity: string, field: string, out: FieldReference[]): void {
  if (!field || field.startsWith("_")) return;
  out.push({ entity, field, origin: "output" });
}
