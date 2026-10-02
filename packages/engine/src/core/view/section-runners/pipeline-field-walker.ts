import type { EntityRegistry } from "../../entity/entity-registry.js";

/**
 * Walks a validated aggregation pipeline and collects every field reference
 * (entity-qualified). Used by `runAggregateSection` to enforce per-field
 * `perm_level` masking — pipelines that reference a protected field on an
 * entity the caller cannot read at that level are rejected.
 *
 * Reference shape:
 *   Source ref: a name a stage reads as a field of the entity: a `$<name>` string in an
 *     expression, a plain key of `$match`, a `$sort` key, `$lookup.localField`, a `$lookup.let`
 *     value, the name `$getField` reads (the leading segment is recorded). `$$ROOT` /
 *     `$$CURRENT`, and a `$getField` whose name is computed, record `WHOLE_DOCUMENT`.
 *   Output ref: a key in `$project`, `$group` (other than `_id`), `$addFields`, `$set` and
 *     `$lookup.as`. Recorded against the active context entity.
 *
 * Joined documents: the `as` of a `$lookup` holds rows of `from`, unless its sub-pipeline
 *   reshaped them. A path through it (`$d.budget`) reads `budget` of `from`, and the bare name
 *   anywhere but `$unwind` or an inclusion `$project` that keeps it in place hands every field
 *   of `from` on (`WHOLE_DOCUMENT`). The runner masks the joined rows only under their own name.
 *
 * Not field references:
 *   A name an earlier stage of the same pipeline produced, and every name after a stage that
 *     replaced the documents ($group, an inclusion $project, $count, $replaceRoot, $replaceWith,
 *     $facet). An exclusion-only $project keeps every other field, so it replaces nothing.
 *   A plain key inside an expression: an output name ($group's object `_id`) or a named
 *     argument of an operator (`format`, `date`, `if`, `then`, `input`).
 *   Variables: `$$NOW`, `$$REMOVE` and the names $let, $map, $filter and `$lookup.let` bind.
 *   Param-resolver tokens: `$root.x`, `$user.x`, `$param.x`.
 *
 * Context entity tracking:
 *   Top-level pipeline runs against `rootEntity`.
 *   Inside `$lookup.pipeline`, the active context entity is `lookup.from`.
 *   `$facet` branches walk sibling pipelines against the parent context. A branch that ends
 *   without a reshape nests the documents whole in its output, where no mask reaches them, so
 *   it reads every field of them (`WHOLE_DOCUMENT`).
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
 * stages produced, whether a reshaping stage has replaced the documents, after which no name
 * means an entity field, and the names that hold joined rows of another entity.
 */
interface WalkState {
  entity: string;
  produced: Set<string>;
  reshaped: boolean;
  joined: Map<string, Joined>;
}

/** The rows a `$lookup` put under a name: the entity they belong to, and the names its sub-pipeline added. */
interface Joined {
  from: string;
  produced: Set<string>;
}

const freshState = (entity: string): WalkState => ({ entity, produced: new Set(), reshaped: false, joined: new Map() });

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
  walkPipeline(pipeline, freshState(rootEntity), registry, out);
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
      if (body && typeof body === "object") walkProject(body as Record<string, unknown>, state, out);
      return;
    case "$addFields":
    case "$set":
      if (body && typeof body === "object") {
        for (const [k, v] of Object.entries(body)) {
          if (!state.produced.has(k) && !state.reshaped) recordOutput(state.entity, k, out);
          walkExpr(v, state, out);
        }
        for (const k of Object.keys(body)) setProduced(state, k);
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
        reshape(state);
      }
      return;
    case "$unwind": {
      const unwind = body && typeof body === "object" ? (body as Record<string, unknown>) : { path: body };
      // Unwinding joined rows keeps them in place under their name, where the runner masks them.
      const path = unwind["path"];
      if (!(typeof path === "string" && state.joined.has(path.slice(1)))) walkExpr(path, state, out);
      if (typeof unwind["includeArrayIndex"] === "string") setProduced(state, unwind["includeArrayIndex"]);
      return;
    }
    case "$sort":
      if (body && typeof body === "object") {
        for (const k of Object.keys(body)) recordName(state, k, out);
      }
      return;
    case "$count":
      if (typeof body === "string") state.produced.add(body);
      reshape(state);
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
        // `let` binds values of the outer document, which the sub-pipeline reads as `$$<name>`.
        walkExpr(lookup["let"], state, out);
        if (typeof as === "string" && !state.produced.has(as) && !state.reshaped) recordOutput(state.entity, as, out);
        if (typeof from !== "string") return;
        const sub = freshState(from);
        if (Array.isArray(subPipeline)) walkPipeline(subPipeline, sub, registry, out);
        // Rows of a further entity the sub-pipeline joined travel nested inside these rows.
        for (const nested of sub.joined.values()) recordSource(nested.from, WHOLE_DOCUMENT, out);
        if (typeof as === "string") {
          setProduced(state, as);
          if (!sub.reshaped) state.joined.set(as, { from, produced: sub.produced });
        }
      }
      return;
    case "$facet":
      if (body && typeof body === "object") {
        for (const childPipe of Object.values(body)) {
          if (!Array.isArray(childPipe)) continue;
          const branch: WalkState = {
            entity: state.entity,
            produced: new Set(state.produced),
            reshaped: state.reshaped,
            joined: new Map(state.joined),
          };
          walkPipeline(childPipe, branch, registry, out);
          // The branch's output nests its documents, which no mask reaches.
          recordWhole(branch, out);
        }
        for (const k of Object.keys(body)) state.produced.add(k);
        reshape(state);
      }
      return;
    case "$replaceRoot":
    case "$replaceWith":
      walkExpr(body, state, out);
      reshape(state);
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
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$getField") walkGetField(v, state, out);
      else walkExpr(v, state, out);
    }
    return;
  }
  if (typeof node === "string") recordIfFieldRef(node, state, out);
}

/**
 * `$getField` names its field by a plain string, `{ $getField: "salary" }`, or by `field` with an
 * optional `input` document. A name it computes could be any field, so it reads them all.
 */
function walkGetField(arg: unknown, state: WalkState, out: FieldReference[]): void {
  const spec = arg && typeof arg === "object" && !Array.isArray(arg) ? (arg as Record<string, unknown>) : { field: arg };
  const field = spec["field"];
  const input = spec["input"];
  const name = typeof field === "string" && !field.startsWith("$") ? field : undefined;
  if (input === undefined || input === "$$CURRENT" || input === "$$ROOT") {
    if (name !== undefined) recordName(state, name, out);
    else {
      walkExpr(field, state, out);
      recordWhole(state, out);
    }
    return;
  }
  const joined = typeof input === "string" ? state.joined.get(input.slice(1)) : undefined;
  if (joined && name !== undefined) {
    if (!joined.produced.has(name)) recordSource(joined.from, name, out);
    return;
  }
  walkExpr(input, state, out);
  walkExpr(field, state, out);
}

function recordIfFieldRef(s: string, state: WalkState, out: FieldReference[]): void {
  if (!s.startsWith("$")) return;
  if (s.startsWith("$$")) {
    // The whole current document hands on every field until a stage reshapes it; other
    // variables ($$NOW, $$REMOVE, a $let or $map name) read no field of the entity.
    const m = s.match(/^\$\$(ROOT|CURRENT)(?:\.([a-zA-Z_][\w.]*))?$/);
    if (m) {
      if (m[2]) recordName(state, m[2], out);
      else recordWhole(state, out);
    }
    return;
  }
  // Skip param-resolver tokens (already substituted earlier) — defensive.
  for (const p of RESERVED_TOKEN_PREFIXES) {
    if (s.startsWith(p) || s === "$now") return;
  }
  // Reject operator-named bare strings ("$first" by itself).
  if (MONGO_OPERATORS.has(s) || STAGE_OPERATORS.has(s)) return;
  // The path after `$`; recordName reads its leading segment, and the next one of joined rows.
  const m = s.match(/^\$([a-zA-Z_][\w]*(?:\.[\w.]+)?)$/);
  if (!m) return;
  recordName(state, m[1]!, out);
}

/**
 * A name a stage reads: a field of the joined entity when it leads through joined rows (all of
 * them for the bare name), else a field of the entity, unless an earlier stage produced it or
 * replaced the documents.
 */
function recordName(state: WalkState, name: string, out: FieldReference[]): void {
  const [leading, next] = name.split(".");
  const joined = state.joined.get(leading!);
  if (joined) {
    if (next === undefined) recordSource(joined.from, WHOLE_DOCUMENT, out);
    else if (!joined.produced.has(next)) recordSource(joined.from, next, out);
    return;
  }
  if (state.produced.has(leading!) || state.reshaped) return;
  recordSource(state.entity, leading!, out);
}

/** The whole current document: every field of the entity until a reshape, and every joined row it carries. */
function recordWhole(state: WalkState, out: FieldReference[]): void {
  if (!state.reshaped) recordSource(state.entity, WHOLE_DOCUMENT, out);
  for (const joined of state.joined.values()) recordSource(joined.from, WHOLE_DOCUMENT, out);
}

/** A stage wrote `name`: it no longer holds what an earlier stage or a join put there. */
function setProduced(state: WalkState, name: string): void {
  const [leading, next] = name.split(".");
  const joined = state.joined.get(leading!);
  if (joined && next !== undefined) joined.produced.add(next);
  else state.joined.delete(leading!);
  state.produced.add(leading!);
}

/** A stage replaced the documents: no later name is an entity field, and no joined rows remain. */
function reshape(state: WalkState): void {
  state.reshaped = true;
  state.joined.clear();
}

/**
 * An exclusion-only `$project` (every value 0 or false) keeps every other field, so it replaces
 * nothing and produces nothing. An inclusion `$project` replaces the documents with the named
 * paths: a kept root field is an output name, a kept path through joined rows reads that field,
 * and joined rows kept whole stay joined under their name, where the runner masks them.
 */
function walkProject(body: Record<string, unknown>, state: WalkState, out: FieldReference[]): void {
  const entries = Object.entries(body);
  const isExcluded = (v: unknown): boolean => v === 0 || v === false;
  if (entries.length > 0 && entries.every(([, v]) => isExcluded(v))) {
    for (const [k] of entries) if (!k.includes(".")) state.joined.delete(k);
    return;
  }
  const kept = new Map<string, Joined>();
  for (const [k, v] of entries) {
    const isKept = v === 1 || v === true;
    const [leading, next] = k.split(".");
    const joined = state.joined.get(leading!);
    if (isKept && joined) {
      if (next !== undefined) recordName(state, k, out);
      kept.set(leading!, joined);
      continue;
    }
    if (!isExcluded(v) && !state.produced.has(leading!) && !state.reshaped) recordOutput(state.entity, k, out);
    walkExpr(v, state, out);
  }
  for (const [k] of entries) state.produced.add(k.split(".")[0]!);
  reshape(state);
  for (const [name, joined] of kept) state.joined.set(name, joined);
}

function recordSource(entity: string, field: string, out: FieldReference[]): void {
  if (!field) return;
  out.push({ entity, field, origin: "source" });
}

function recordOutput(entity: string, field: string, out: FieldReference[]): void {
  if (!field || field.startsWith("_")) return;
  out.push({ entity, field, origin: "output" });
}
