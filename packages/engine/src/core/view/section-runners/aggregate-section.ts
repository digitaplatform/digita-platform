import type { AggregateSection, EntityDefinition } from "@digitaplatform/shared";
import type { Document } from "mongodb";
import type { MongoDBService } from "../../database/mongodb-service.js";
import type { EntityRegistry } from "../../entity/entity-registry.js";
import type { PermissionChecker } from "../../permissions/permission-checker.js";
import { PermissionDeniedError } from "../../permissions/permission-checker.js";
import type { UserContext } from "../../permissions/types.js";
import { applyScopeFilters } from "../../permissions/scope-filter.js";
import { resolveTokens, type ResolverContext } from "../param-resolver.js";
import { collectFieldReferences } from "./pipeline-field-walker.js";
import { coerceMatchDates } from "../../database/filter-value-coercer.js";
import { readStoredRow } from "../../entity/field-types.js";

/** Pipeline stages after which field names / entity context change — date-match
 *  coercion (which resolves field types against the section entity) must stop here. */
const RESHAPE_STAGE_KEYS = new Set([
  "$group",
  "$project",
  "$addFields",
  "$set",
  "$replaceRoot",
  "$replaceWith",
  "$bucket",
  "$bucketAuto",
  "$unwind",
  "$lookup",
  "$facet",
  "$unionWith",
]);

export interface AggregateRunnerDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  permissionChecker: PermissionChecker;
}

/**
 * Resolve an aggregate section by:
 *   1. Checking the caller's `select` permission on the section entity AND on
 *      every `$lookup.from` collection referenced in the pipeline, and refusing
 *      any of them whose level-0 read for the caller carries a `condition`.
 *   2. Prepending a security $match stage built from `applyScopeFilters`.
 *   3. Substituting reserved tokens via `resolveTokens` (deep-clone walk).
 *   4. Executing via `MongoDBService.aggregate`.
 *
 * All RBAC failures bubble as `PermissionDeniedError` — the caller's section
 * fallback policy decides whether that turns into a path-tagged warning or a
 * hard error.
 */
export async function runAggregateSection(
  section: AggregateSection,
  rctx: ResolverContext,
  user: UserContext,
  deps: AggregateRunnerDeps,
): Promise<Document[]> {
  const entity = deps.registry.get(section.entity);

  // 1. RBAC on the source entity. A level-0 read with a `condition` cannot become the
  // security $match, and a row cannot be re-checked after a reshaping stage.
  await deps.permissionChecker.check(user, section.entity, "select");
  if (deps.permissionChecker.hasConditionalRowRead(user, section.entity)) {
    throw new PermissionDeniedError("aggregate_bypasses_read_condition", { doctype: section.entity });
  }

  // 1b. RBAC on every $lookup.from in the pipeline (depth-first).
  const lookupTargets = collectLookupTargets(section.pipeline);
  for (const fromEntity of lookupTargets) {
    // H-3: a $lookup into an UNREGISTERED collection would bypass RBAC + DB
    // routing (e.g. read the identity/system collections), so forbid it
    // rather than silently skipping the check.
    if (!deps.registry.has(fromEntity)) {
      throw PermissionDeniedError.forAction(fromEntity, "select");
    }
    await deps.permissionChecker.check(user, fromEntity, "select");
    // H3: the security $match is built only for the ROOT section entity, so a
    // bare $lookup can't carry the joined entity's row-level scope. Refuse when
    // the user's read on the joined entity is row-restricted (if_owner or scope)
    // — otherwise the join returns rows outside their scope.
    const fromDef = deps.registry.get(fromEntity);
    if (Object.keys(applyScopeFilters(fromDef, user, {})).length > 0) {
      throw new PermissionDeniedError("lookup_bypasses_row_scope", { doctype: fromEntity });
    }
    if (deps.permissionChecker.hasConditionalRowRead(user, fromEntity)) {
      throw new PermissionDeniedError("lookup_bypasses_read_condition", { doctype: fromEntity });
    }
  }

  // 1c. Field-level perm_level enforcement.
  //
  // Collect every field reference in the pipeline (qualified by the entity
  // active at that point — root for top-level stages, lookup.from inside
  // $lookup.pipeline). Two checks apply:
  //
  //   SOURCE refs (`$<field>` expressions, `$match` keys): the user must
  //     be able to read that field on its entity. Reject otherwise.
  //   OUTPUT refs (`$project` / `$group` / `$addFields` keys): only reject
  //     when the output name COINCIDES with a real source field that's
  //     protected — that's a leak (`$project: { salary: 1 }` echoes a
  //     protected field through). Synthetic names like `total`/`count`
  //     are not source fields and are fine.
  const readableByEntity = new Map<string, Set<string> | null>();
  const allFieldsByEntity = new Map<string, Set<string>>();
  const learnEntity = (name: string): void => {
    if (readableByEntity.has(name)) return;
    if (!deps.registry.has(name)) return;
    readableByEntity.set(name, deps.permissionChecker.getReadableFieldsOnEveryRow(user, name));
    const def = deps.registry.get(name);
    const fieldList = def.fields ?? [];
    allFieldsByEntity.set(name, new Set(fieldList.map((f) => f.fieldname)));
  };
  learnEntity(section.entity);
  for (const fromEntity of lookupTargets) learnEntity(fromEntity);

  const refs = collectFieldReferences(section.pipeline, section.entity, deps.registry);
  for (const ref of refs) {
    // A Password value leaves the engine on no read path (#78), so a pipeline
    // that names the field, as a source or as an output name, is refused for
    // every reader, an Administrator included.
    if (deps.registry.has(ref.entity) && passwordFields(deps.registry.get(ref.entity)).includes(ref.field)) {
      throw new PermissionDeniedError("aggregation_references_protected_field", { doctype: ref.entity });
    }
    const readable = readableByEntity.get(ref.entity);
    if (readable === null || readable === undefined) continue; // null = all readable (admin/missing); permissive
    if (META_FIELDS.has(ref.field)) continue;
    if (ref.field.startsWith("_")) continue;

    if (ref.origin === "source") {
      if (!readable.has(ref.field)) {
        throw new PermissionDeniedError("aggregation_references_protected_field", { doctype: ref.entity });
      }
      continue;
    }

    // Output ref: only reject when the output name shadows a protected
    // source field on the same entity.
    const allFields = allFieldsByEntity.get(ref.entity);
    if (allFields?.has(ref.field) && !readable.has(ref.field)) {
      throw new PermissionDeniedError("aggregation_references_protected_field", { doctype: ref.entity });
    }
  }

  // 2. Build security $match.
  const scope = applyScopeFilters(entity, user, {});
  const securityMatch = Object.keys(scope).length > 0 ? [{ $match: scope } as Document] : [];

  // 3. Resolve tokens.
  const userPipeline = resolveTokens(section.pipeline, rctx) as Document[];

  // Coerce date/datetime operands in TOP-LEVEL $match stages (before the first
  // reshape/join) to their stored form — same reason as the list path: a resolved
  // `$now` token is a Date object, but a Date field is stored as a "YYYY-MM-DD"
  // string, so an uncoerced $match silently matches 0 rows. Stop at the first
  // $group/$project/$lookup/$unwind/etc.: past that the field names/entity context
  // change, so sub-pipeline ($lookup/$facet) $match dates are intentionally NOT
  // coerced here (rare; a follow-up if a report needs it).
  let reshaped = false;
  const coercedUserPipeline = userPipeline.map((stage) => {
    const coerced =
      !reshaped && stage["$match"] && typeof stage["$match"] === "object" && !Array.isArray(stage["$match"])
        ? { ...stage, $match: coerceMatchDates(entity, stage["$match"] as Document) }
        : stage;
    if (Object.keys(stage).some((k) => RESHAPE_STAGE_KEYS.has(k))) reshaped = true;
    return coerced;
  });

  // A Password value never enters the pipeline: it is dropped right after the
  // security $match, and at the head of every $lookup sub-pipeline from an
  // entity that stores one, so no later stage can output it under any name. A
  // $lookup without a sub-pipeline gets one of the $unset alone, because it
  // joins whole rows that any later stage may copy or move.
  const finalPipeline = [
    ...securityMatch,
    ...unsetPasswords(entity),
    ...coercedUserPipeline.map((stage) => unsetPasswordsInLookups(stage, deps.registry)),
  ];

  // 4. Execute.
  const rows = await deps.db.aggregate(section.entity, finalPipeline, entity.database);

  // 5. A row that keeps the entity's row shape is read as every path reads a
  //    stored row (readStoredRow); the rows a bare $lookup joins whole, in the
  //    joined entity's row shape, are read the same way through that entity.
  //    Then defence in depth, two per-row strips:
  //   (a) section-entity output keys that shadow a protected source field.
  //   (b) H4: nested foreign docs emitted by a bare $lookup — mask each through
  //       the JOINED entity's readable field set, so perm_level-protected fields
  //       don't leak via the join. The static field-walker only records the `as`
  //       key against the ROOT entity, so an unmasked `$lookup ... as: "inv"`
  //       otherwise forwards every nested protected field intact.
  const sectionReadable = readableByEntity.get(section.entity);
  const sectionAllFields = allFieldsByEntity.get(section.entity);
  const lookupOutputs = collectLookupOutputs(section.pipeline);
  const needsSectionStrip = !!(sectionReadable && sectionAllFields);
  const needsLookupMask = lookupOutputs.some((o) => !!readableByEntity.get(o.from));
  const joinedReads = lookupOutputs.filter((o) => o.joinsRows && deps.registry.has(o.from));
  if (reshaped && !needsSectionStrip && !needsLookupMask && joinedReads.length === 0) return rows;

  return rows.map((row) => {
    const read = reshaped ? row : readStoredRow(entity, row);
    const r: Document = needsSectionStrip
      ? filterAggregateRow(read, sectionReadable!, sectionAllFields!)
      : { ...read };
    for (const { as, from } of joinedReads) {
      if (as in r) r[as] = mapForeignValue(r[as], (doc) => readStoredRow(deps.registry.get(from), doc));
    }
    for (const { as, from } of lookupOutputs) {
      if (!(as in r)) continue;
      const readable = readableByEntity.get(from);
      if (!readable) continue; // null = all readable (admin) → no mask
      r[as] = maskForeignValue(r[as], readable);
    }
    return r;
  });
}

function passwordFields(def: EntityDefinition): string[] {
  return (def.fields ?? []).filter((f) => f.fieldtype === "Password").map((f) => f.fieldname);
}

/** The stage that drops an entity's Password fields, or nothing when it stores none. */
function unsetPasswords(def: EntityDefinition): Document[] {
  const fields = passwordFields(def);
  return fields.length ? [{ $unset: fields }] : [];
}

/** The stage with the Password fields of every joined entity dropped at the head
 *  of its `$lookup` sub-pipeline, `$facet` branches included. A `$lookup` with
 *  `localField`/`foreignField` and no sub-pipeline gets one of the $unset alone
 *  (MongoDB 5.0 and later take both together). */
function unsetPasswordsInLookups(stage: Document, registry: EntityRegistry): Document {
  const lookup = stage["$lookup"];
  if (lookup && typeof lookup === "object" && registry.has(lookup["from"])) {
    const unset = unsetPasswords(registry.get(lookup["from"]));
    const pipeline = Array.isArray(lookup["pipeline"])
      ? (lookup["pipeline"] as Document[]).map((s) => unsetPasswordsInLookups(s, registry))
      : undefined;
    if (!pipeline && unset.length === 0) return stage;
    return { ...stage, $lookup: { ...lookup, pipeline: [...unset, ...(pipeline ?? [])] } };
  }
  const facet = stage["$facet"];
  if (facet && typeof facet === "object") {
    const branches = Object.entries(facet as Record<string, unknown>).map(([k, branch]) => [
      k,
      Array.isArray(branch) ? branch.map((s) => unsetPasswordsInLookups(s as Document, registry)) : branch,
    ]);
    return { ...stage, $facet: Object.fromEntries(branches) };
  }
  return stage;
}

/** Collect every $lookup `{ as, from }` in the pipeline (depth-first, incl.
 *  nested $lookup.pipeline and $facet children) so the runner can mask the
 *  foreign docs each one emits. `joinsRows` is true for a $lookup without a
 *  sub-pipeline: it joins the foreign rows whole, in their stored shape. */
function collectLookupOutputs(
  pipeline: unknown,
  out: Array<{ as: string; from: string; joinsRows: boolean }> = [],
): Array<{ as: string; from: string; joinsRows: boolean }> {
  if (!Array.isArray(pipeline)) return out;
  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object") continue;
    const lookup = (stage as Record<string, unknown>)["$lookup"];
    if (lookup && typeof lookup === "object") {
      const from = (lookup as Record<string, unknown>)["from"];
      const as = (lookup as Record<string, unknown>)["as"];
      const joinsRows = !Array.isArray((lookup as Record<string, unknown>)["pipeline"]);
      if (typeof from === "string" && typeof as === "string") out.push({ as, from, joinsRows });
      collectLookupOutputs((lookup as Record<string, unknown>)["pipeline"], out);
    }
    const facet = (stage as Record<string, unknown>)["$facet"];
    if (facet && typeof facet === "object") {
      for (const child of Object.values(facet as Record<string, unknown>)) {
        collectLookupOutputs(child, out);
      }
    }
  }
  return out;
}

/** Mask a $lookup output (array of joined docs, or a single doc) through the
 *  joined entity's readable field set. */
function maskForeignValue(value: unknown, readable: Set<string>): unknown {
  return mapForeignValue(value, (doc) => maskForeignDoc(doc, readable) as Document);
}

/** A $lookup output (array of joined docs, or a single doc) with `read` applied to each doc. */
function mapForeignValue(value: unknown, read: (doc: Document) => Document): unknown {
  const one = (doc: unknown) => (doc && typeof doc === "object" ? read(doc as Document) : doc);
  return Array.isArray(value) ? value.map(one) : one(value);
}

function maskForeignDoc(doc: unknown, readable: Set<string>): unknown {
  if (!doc || typeof doc !== "object") return doc;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (META_FIELDS.has(k) || k.startsWith("_") || readable.has(k)) out[k] = v;
  }
  return out;
}

const META_FIELDS = new Set([
  "_id",
  "_row_id",
  "doctype",
  "docstatus",
  "owner",
  "modified_by",
  "creation",
  "modified",
]);

function filterAggregateRow(
  row: Document,
  readable: Set<string>,
  allFields: Set<string>,
): Document {
  const out: Document = {};
  for (const [k, v] of Object.entries(row)) {
    if (META_FIELDS.has(k) || k.startsWith("_")) {
      out[k] = v;
      continue;
    }
    // Strip ONLY if the key name shadows a real source-entity field that's
    // protected. Pure synthetic names (`count`, `total`, `revenue_sum`) pass
    // through — they aren't source fields and carry no leak risk.
    if (allFields.has(k) && !readable.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function collectLookupTargets(pipeline: unknown, out: Set<string> = new Set()): Set<string> {
  if (!Array.isArray(pipeline)) return out;
  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object") continue;
    const lookup = (stage as Record<string, unknown>)["$lookup"];
    if (lookup && typeof lookup === "object") {
      const from = (lookup as Record<string, unknown>)["from"];
      if (typeof from === "string") out.add(from);
      const subPipeline = (lookup as Record<string, unknown>)["pipeline"];
      collectLookupTargets(subPipeline, out);
    }
    const facet = (stage as Record<string, unknown>)["$facet"];
    if (facet && typeof facet === "object") {
      for (const child of Object.values(facet as Record<string, unknown>)) {
        collectLookupTargets(child, out);
      }
    }
  }
  return out;
}
