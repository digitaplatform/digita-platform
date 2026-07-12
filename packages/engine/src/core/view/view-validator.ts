import type {
  ViewDefinition,
  ViewSection,
  AggregateSection,
  ListSection,
  LinkSection,
  ViewParamDefinition,
} from "@digitaplatform/shared";

const KINDS = new Set(["link", "list", "aggregate"]);
const PARAM_TYPES = new Set(["string", "number", "boolean", "date", "duration", "enum"]);

const FILTER_OPS = new Set([
  "=",
  "==",
  "!=",
  "<>",
  ">",
  ">=",
  "<",
  "<=",
  "in",
  "not in",
  "like",
  "not like",
  "between",
  "is",
  "regex",
  "exists",
]);

const ALLOWED_STAGES = new Set([
  "$match",
  "$unwind",
  "$group",
  "$sort",
  "$limit",
  "$skip",
  "$project",
  "$addFields",
  "$count",
  "$facet",
  "$lookup",
]);

const FORBIDDEN_OPERATORS = new Set([
  "$where",
  "$function",
  "$accumulator",
  "$out",
  "$merge",
  "$graphLookup",
  // $unionWith reads a second collection into the result — a cross-collection
  // read-through that bypasses the scoped source collection. Listed here so the
  // deep collectForbiddenOps walker catches it at ANY nesting depth (it could
  // otherwise be smuggled inside a nested $facet/$lookup sub-pipeline).
  "$unionWith",
]);

const ALLOWED_OPERATORS = new Set([
  // arithmetic
  "$add",
  "$subtract",
  "$multiply",
  "$divide",
  "$mod",
  "$abs",
  "$ceil",
  "$floor",
  "$round",
  "$trunc",
  // comparison
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$cmp",
  // conditional
  "$cond",
  "$ifNull",
  "$switch",
  // accumulators
  "$sum",
  "$avg",
  "$min",
  "$max",
  "$first",
  "$last",
  "$push",
  "$addToSet",
  "$count",
  // array
  "$size",
  "$arrayElemAt",
  "$slice",
  "$filter",
  "$map",
  "$concatArrays",
  "$in",
  "$isArray",
  // string
  "$concat",
  "$toLower",
  "$toUpper",
  "$split",
  "$substr",
  "$strLen",
  "$trim",
  "$regexMatch",
  // date
  "$year",
  "$month",
  "$dayOfMonth",
  "$dayOfWeek",
  "$dayOfYear",
  "$hour",
  "$minute",
  "$second",
  "$dateToString",
  "$dateFromString",
  "$dateTrunc",
  "$dateAdd",
  "$dateSubtract",
  "$dateDiff",
  // type
  "$toString",
  "$toInt",
  "$toLong",
  "$toDouble",
  "$toDecimal",
  "$toDate",
  "$toBool",
  "$type",
  "$convert",
  // logical
  "$and",
  "$or",
  "$not",
  // misc / common pipeline expression keys (plumbing — not stages)
  "$expr",
  "$exists",
  "$elemMatch",
  "$regex",
  "$options",
  "$gte",
  "$lte",
  "$mergeObjects",
  "$literal",
]);

const RESERVED_PREFIXES = ["$root.", "$user.", "$param."];

export interface ValidationFailure {
  message: string;
}

/**
 * Hand-rolled validator that mirrors the platform pattern (see entity-registry,
 * rule-loader). Returns a list of human-readable failure messages, empty on
 * success. The loader skips the file with a logged warning when the list is
 * non-empty — the bad view is dropped, the rest of the boot proceeds.
 */
export function validateViewDefinition(view: unknown): ValidationFailure[] {
  const errors: ValidationFailure[] = [];
  const fail = (m: string) => errors.push({ message: m });

  if (!view || typeof view !== "object") {
    fail("view definition must be an object");
    return errors;
  }
  const v = view as Record<string, unknown>;

  if (typeof v["_id"] !== "string" || !v["_id"]) fail("missing or empty `_id`");
  if (typeof v["name"] !== "string" || !v["name"]) fail("missing or empty `name`");

  const anchored = v["anchored"] !== false; // default true
  if (anchored) {
    const src = v["source"] as Record<string, unknown> | undefined;
    if (!src || typeof src !== "object") fail("anchored view requires `source`");
    else {
      if (typeof src["entity"] !== "string" || !src["entity"]) fail("`source.entity` required");
      if (typeof src["param"] !== "string" || !src["param"]) fail("`source.param` required");
    }
  }

  const params = (v["params"] ?? []) as ViewParamDefinition[];
  const paramNames = new Set<string>();
  if (!Array.isArray(params)) {
    fail("`params` must be an array");
  } else {
    for (let i = 0; i < params.length; i++) {
      const p = params[i] as ViewParamDefinition | undefined;
      if (!p || typeof p !== "object") {
        fail(`params[${i}] must be an object`);
        continue;
      }
      if (!p.name || typeof p.name !== "string") fail(`params[${i}].name required`);
      else if (paramNames.has(p.name)) fail(`duplicate param name "${p.name}"`);
      else paramNames.add(p.name);
      if (!p.type || !PARAM_TYPES.has(p.type)) fail(`params[${i}].type invalid: ${p.type}`);
      if (p.required && p.default !== undefined) {
        fail(`params[${i}] cannot be required and have a default`);
      }
    }
  }

  if (anchored) {
    const src = v["source"] as Record<string, unknown> | undefined;
    if (src && typeof src["param"] === "string" && !paramNames.has(src["param"] as string)) {
      fail(`source.param "${src["param"]}" not declared in params[]`);
    }
  }

  const sections = v["sections"];
  if (!Array.isArray(sections) || sections.length === 0) {
    fail("`sections` must be a non-empty array");
    return errors;
  }
  const sectionKeys = new Set<string>();
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i] as ViewSection | undefined;
    if (!sec || typeof sec !== "object") {
      fail(`sections[${i}] must be an object`);
      continue;
    }
    if (!sec.key || typeof sec.key !== "string") fail(`sections[${i}].key required`);
    else if (sectionKeys.has(sec.key)) fail(`duplicate section key "${sec.key}"`);
    else sectionKeys.add(sec.key);

    if (!sec.entity || typeof sec.entity !== "string") fail(`sections[${i}].entity required`);
    if (!sec.kind || !KINDS.has(sec.kind)) {
      fail(`sections[${i}].kind invalid: ${sec.kind}`);
      continue;
    }

    if (sec.kind === "link") validateLinkSection(sec as LinkSection, i, fail);
    else if (sec.kind === "list") validateListSection(sec as ListSection, i, fail);
    else if (sec.kind === "aggregate") validateAggregateSection(sec as AggregateSection, i, fail);

    // Reject `$root.*` token usage in unanchored views — surface at boot, not at request time.
    if (!anchored) {
      const offenders = collectRootTokens(sec);
      for (const t of offenders) fail(`sections[${i}] uses "${t}" but view is unanchored`);
    }

    // Reject unknown reserved-prefix tokens (e.g. typos like `$rooot.id`) — anything
    // starting with `$` that's NOT a reserved prefix is left alone (could be a
    // legitimate Mongo expression like `$lines.product`).
    const badTokens = collectMalformedTokens(sec);
    for (const t of badTokens) fail(`sections[${i}] has malformed token "${t}"`);

    // Param tokens must reference declared params.
    const paramRefs = collectParamRefs(sec);
    for (const name of paramRefs) {
      if (!paramNames.has(name)) fail(`sections[${i}] references unknown param "$param.${name}"`);
    }
  }

  return errors;
}

function validateLinkSection(s: LinkSection, idx: number, fail: (m: string) => void): void {
  if (!s.target || typeof s.target !== "string") {
    fail(`sections[${idx}] (link) requires \`target\``);
  }
}

function validateListSection(s: ListSection, idx: number, fail: (m: string) => void): void {
  for (const key of ["filter", "or_filter"] as const) {
    const arr = s[key];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) {
      fail(`sections[${idx}].${key} must be an array`);
      continue;
    }
    for (let j = 0; j < arr.length; j++) {
      const t = arr[j];
      if (!Array.isArray(t) || t.length !== 3) {
        fail(`sections[${idx}].${key}[${j}] must be a 3-tuple [field, op, value]`);
        continue;
      }
      const [field, op] = t;
      if (typeof field !== "string" || !field) fail(`sections[${idx}].${key}[${j}].field required`);
      if (typeof op !== "string" || !FILTER_OPS.has(op))
        fail(`sections[${idx}].${key}[${j}].op invalid: ${op}`);
    }
  }
  if (s.expand) {
    if (!s.expand.field) fail(`sections[${idx}].expand.field required`);
    if (!s.expand.entity) fail(`sections[${idx}].expand.entity required`);
  }
  if (s.limit !== undefined && (typeof s.limit !== "number" || s.limit < 0)) {
    fail(`sections[${idx}].limit must be a non-negative number`);
  }
}

function validateAggregateSection(
  s: AggregateSection,
  idx: number,
  fail: (m: string) => void,
): void {
  if (!Array.isArray(s.pipeline)) {
    fail(`sections[${idx}] (aggregate) pipeline must be an array`);
    return;
  }
  validatePipelineStages(s.pipeline, `sections[${idx}].pipeline`, fail);
}

/**
 * Whitelist every stage in a pipeline AND recurse into the sub-pipelines that
 * $facet / $lookup carry. Recursion is what closes the escape where a
 * non-whitelisted stage (e.g. $unionWith) hid two-plus levels deep inside a
 * nested $lookup.pipeline that the old one-level check never re-validated.
 */
function validatePipelineStages(pipeline: unknown[], path: string, fail: (m: string) => void): void {
  for (let stageIdx = 0; stageIdx < pipeline.length; stageIdx++) {
    const stage = pipeline[stageIdx];
    if (!stage || typeof stage !== "object") {
      fail(`${path}[${stageIdx}] must be an object`);
      continue;
    }
    const keys = Object.keys(stage);
    if (keys.length !== 1) {
      fail(`${path}[${stageIdx}] must have exactly one stage operator`);
      continue;
    }
    const stageKey = keys[0]!;
    if (!ALLOWED_STAGES.has(stageKey)) {
      fail(`${path}[${stageIdx}] forbidden stage "${stageKey}"`);
      continue;
    }
    // Recurse into the stage body for forbidden ops (deep) at every level.
    for (const op of collectForbiddenOps((stage as Record<string, unknown>)[stageKey])) {
      fail(`${path}[${stageIdx}] forbidden operator "${op}"`);
    }
    // $facet: every child pipeline is a full pipeline — validate it recursively.
    if (stageKey === "$facet") {
      const body = (stage as Record<string, unknown>)["$facet"] as Record<string, unknown>;
      for (const [facetKey, childPipe] of Object.entries(body ?? {})) {
        if (!Array.isArray(childPipe)) {
          fail(`${path}[${stageIdx}].$facet.${facetKey} must be an array`);
          continue;
        }
        validatePipelineStages(childPipe, `${path}[${stageIdx}].$facet.${facetKey}`, fail);
      }
    }
    // $lookup: the embedded pipeline (if any) is a full pipeline too.
    if (stageKey === "$lookup") {
      const sub = ((stage as Record<string, unknown>)["$lookup"] as Record<string, unknown>)?.[
        "pipeline"
      ];
      if (Array.isArray(sub)) {
        validatePipelineStages(sub, `${path}[${stageIdx}].$lookup.pipeline`, fail);
      }
    }
  }
}

function collectForbiddenOps(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectForbiddenOps(child, out);
    return out;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith("$")) {
        if (FORBIDDEN_OPERATORS.has(k)) out.push(k);
        // Stage keys ($match, $group, …) appear at top level only — inside a
        // stage body, an operator key like `$avg` is fine if whitelisted. We
        // don't fail for *unknown* operators here; the Mongo driver will. This
        // mirrors the platform's hand-rolled validation philosophy: cheap
        // structural checks at boot, full semantic checks deferred to runtime.
      }
      collectForbiddenOps(v, out);
    }
    return out;
  }
  return out;
}

function collectRootTokens(node: unknown, out: string[] = []): string[] {
  walkStrings(node, (s) => {
    if (s.startsWith("$root.")) out.push(s);
  });
  return out;
}

function collectMalformedTokens(node: unknown, out: string[] = []): string[] {
  walkStrings(node, (s) => {
    // Only flag strings that start with a reserved prefix but don't conform.
    for (const p of RESERVED_PREFIXES) {
      if (s.startsWith(p)) {
        const rest = s.slice(p.length);
        if (!/^[\w.]+$/.test(rest)) out.push(s);
        return;
      }
    }
    if (s === "$now") return;
    if (/^\$now\s*[+-]\s*(P\S+|\$param\.[\w]+)$/.test(s)) return;
  });
  return out;
}

function collectParamRefs(node: unknown, out: string[] = []): string[] {
  walkStrings(node, (s) => {
    const m = s.match(/^\$param\.(\w+)/);
    if (m) out.push(m[1]!);
    // Inside `$now ± $param.X`
    const m2 = s.match(/^\$now\s*[+-]\s*\$param\.(\w+)$/);
    if (m2) out.push(m2[1]!);
  });
  return out;
}

function walkStrings(node: unknown, fn: (s: string) => void): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    fn(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const c of node) walkStrings(c, fn);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) walkStrings(v, fn);
  }
}

export const VIEW_VALIDATOR_INTERNAL = {
  ALLOWED_STAGES,
  ALLOWED_OPERATORS,
  FORBIDDEN_OPERATORS,
  FILTER_OPS,
};
