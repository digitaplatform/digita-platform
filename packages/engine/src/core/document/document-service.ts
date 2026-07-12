import type { EntityDefinition, ActionDefinition, TransitionDefinition, SubmittedPatch } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES, DIGITA, DocStatus } from "@digitaplatform/shared";
import { calculateChanges, deepEqual, type FieldChange } from "./change-tracker.js";
import type { DocumentServiceDeps } from "./service-deps.js";
import type { HookServices } from "../hooks/hook-runner.js";
import type { UserContext } from "../permissions/types.js";
import { ActionRunner } from "../action/action-runner.js";
import { BaseDocument } from "./base-document.js";
import { NamingService } from "./naming-service.js";
import { toIdString } from "./id-codec.js";
import { DocStatusEngine, DocStatusError } from "./docstatus-engine.js";
import { validateEntityDataZod } from "../entity/entity-validator-zod.js";
import { ZodSchemaBuilder } from "../entity/zod-schema-builder.js";
import { IllegalTransitionError } from "../workflow/workflow-engine.js";
import { getFieldTypeHandler, isStoredFieldType, FieldValueError } from "../entity/field-types.js";
import { copyDocumentData } from "./copy-service.js";
import { resolveDefaults, applyNewChildRowDefaults } from "../defaults/default-resolver.js";
import { applyScopeFilters, applyRoleVisibilityFilter, isRoleVisible } from "../permissions/scope-filter.js";
import { env } from "../config/env.js";
import { PermissionDeniedError } from "../permissions/permission-checker.js";
import { DocumentShareService } from "../permissions/document-share-service.js";
import { entityHasAnySnapshot, entityHasAnyFreeze } from "../snapshot/snapshot-resolver.js";
import { resolveStatusIndicator } from "../status/status-resolver.js";
import type { StoragePort } from "../storage/storage-port.js";
import { collectAttachFileIds, deleteFileRefCounted, cleanupDocumentAttachments, parseFileId, FILE_FIELD_TYPES } from "../storage/file-cleanup.js";
import {
  buildMongoFilter,
  assertFieldAllowed,
  buildSort,
  parsePagination,
  type ListQuery,
} from "../database/filter-builder.js";
import { coerceDateFilterValues } from "../database/filter-value-coercer.js";
import type { ResponseContext } from "../api/response-context.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("document-service");

export class NotFoundError extends Error {
  constructor(
    public doctype: string,
    public documentName: string,
  ) {
    super(`${doctype} ${documentName} not found`);
    this.name = "NotFoundError";
  }
}

/**
 * Raised when a meta-declared action has no registered handler. Prevents a
 * long_running (jobs) action from reporting silent success while doing nothing.
 */
export class ActionHandlerMissingError extends Error {
  constructor(
    public doctype: string,
    public actionName: string,
  ) {
    super(`No handler registered for action "${actionName}" on ${doctype}`);
    this.name = "ActionHandlerMissingError";
  }
}

export class ValidationFailedError extends Error {
  constructor(
    public doctype: string,
    public errors: Array<{
      field: string;
      message_key: string;
      params?: Record<string, string>;
    }>,
  ) {
    super(`Validation failed for ${doctype}: ${errors.length} error(s)`);
    this.name = "ValidationFailedError";
  }
}

/**
 * Optimistic-concurrency guard failure. Thrown by `update` when the caller
 * sends the `modified` version it last saw (If-Match) and the stored document
 * has advanced since — i.e. someone else wrote it in between. Opt-in: callers
 * that omit the expected version keep last-write-wins semantics.
 */
export class ConcurrentModificationError extends Error {
  constructor(
    public doctype: string,
    public documentName: string,
    public expected: string,
    public actual: string,
  ) {
    super(
      `${doctype} ${documentName} was modified concurrently (expected ${expected}, found ${actual})`,
    );
    this.name = "ConcurrentModificationError";
  }
}

export class TimeSeriesImmutableError extends Error {
  constructor(
    public doctype: string,
    public attempted_fields: string[],
    public meta_field: string | undefined,
  ) {
    const allowed = meta_field
      ? `Only the meta_field "${meta_field}" can be patched.`
      : `No field updates are allowed (no meta_field declared).`;
    super(
      `Cannot update time-series ${doctype}: tried to change ${attempted_fields.join(", ")}. ${allowed}`,
    );
    this.name = "TimeSeriesImmutableError";
  }
}

export class DeleteBlockedError extends Error {
  public doctype: string;
  public documentName: string;
  public blockers: Array<{ entity: string; count: number }>;

  constructor(
    doctype: string,
    documentName: string,
    blockers: Array<{ entity: string; count: number }>,
  ) {
    const details = blockers.map((b) => `${b.count} ${b.entity}`).join(", ");
    super(`Cannot delete ${doctype} ${documentName}: referenced by ${details}`);
    this.name = "DeleteBlockedError";
    this.doctype = doctype;
    this.documentName = documentName;
    this.blockers = blockers;
  }
}

/**
 * Raised when a cancel is attempted on a document that has been forwarded
 * into a downstream submitted document. Forward immutability — the upstream
 * is locked until the downstream is cancelled first.
 */
export class CancelBlockedError extends Error {
  public doctype: string;
  public documentName: string;
  public blockers: Array<{ entity: string; count: number }>;

  constructor(
    doctype: string,
    documentName: string,
    blockers: Array<{ entity: string; count: number }>,
  ) {
    const details = blockers.map((b) => `${b.count} ${b.entity}`).join(", ");
    super(
      `Cannot cancel ${doctype} ${documentName}: forwarded into submitted ${details}`,
    );
    this.name = "CancelBlockedError";
    this.doctype = doctype;
    this.documentName = documentName;
    this.blockers = blockers;
  }
}

/**
 * A submit tried to forward a document into a submittable link target that has
 * itself been CANCELLED. The submit-side guard (guardSubmittableLinkTargets) closes
 * the cancel/submit write-skew: if `cancel(target)` committed first, submit's
 * conflicting guard write retries with a fresh snapshot and this re-read catches the
 * cancelled target — refusing rather than forwarding into a dead upstream.
 */
export class LinkTargetCancelledError extends Error {
  constructor(
    public doctype: string,
    public fieldname: string,
    public targetEntity: string,
    public targetName: string,
  ) {
    super(
      `Cannot submit ${doctype}: its ${fieldname} → ${targetEntity} "${targetName}" has been cancelled`,
    );
    this.name = "LinkTargetCancelledError";
  }
}

export interface ListResult {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const GUEST_USER: UserContext = {
  _id: "Guest",
  email: "Guest",
  roles: ["Guest"],
};

export class DocumentService {
  private namingService: NamingService;
  private docStatusEngine: DocStatusEngine;

  private registry;
  private db;
  private permissionChecker;
  private hookRunner;
  private linkValidator;
  private linkTitleResolver;
  private fetchFromResolver;
  private snapshotResolver;
  private zodSchemaBuilder;
  private workflowEngine;
  private periodCloseValidator;
  private deleteProtection;
  private cancelProtection;
  private documentShareService;
  private versionService;
  private viewLogService;
  private translationService;
  private activityLogService;
  private ruleEngine;
  private actionRunner;
  private storage?: StoragePort;

  /**
   * Fire-and-forget wrapper that logs errors instead of silently swallowing them.
   */
  private safeBackground(
    promise: Promise<unknown>,
    context: { operation: string; doctype: string; name: string },
  ): void {
    promise.catch((err) => {
      log.error({ err, ...context }, "Background operation failed");
    });
  }

  constructor(deps: DocumentServiceDeps) {
    this.registry = deps.registry;
    this.db = deps.db;
    this.permissionChecker = deps.permissionChecker;
    this.hookRunner = deps.hookRunner;
    this.linkValidator = deps.linkValidator;
    this.linkTitleResolver = deps.linkTitleResolver;
    this.fetchFromResolver = deps.fetchFromResolver;
    this.snapshotResolver = deps.snapshotResolver;
    this.zodSchemaBuilder = deps.zodSchemaBuilder ?? new ZodSchemaBuilder();
    this.workflowEngine = deps.workflowEngine;
    this.periodCloseValidator = deps.periodCloseValidator;
    this.deleteProtection = deps.deleteProtection;
    this.cancelProtection = deps.cancelProtection;
    this.documentShareService = deps.documentShareService ?? new DocumentShareService(deps.db);
    this.versionService = deps.versionService;
    this.viewLogService = deps.viewLogService;
    this.translationService = deps.translationService;
    this.activityLogService = deps.activityLogService;
    this.ruleEngine = deps.ruleEngine;
    this.storage = deps.storage;

    this.namingService = new NamingService(deps.db);
    this.docStatusEngine = new DocStatusEngine();
    this.actionRunner = new ActionRunner(deps.permissionChecker);
  }

  /**
   * Available actions for a document: entity.actions filtered by each action's
   * `show_if` expression and `requires_permission` against this doc + user.
   * Read access is enforced first (RBAC or DocShare).
   */
  async getAvailableActions(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
  ): Promise<ActionDefinition[]> {
    const entity = this.registry.get(doctype);
    const doc = await this.loadDocInternal(doctype, name);
    await this.assertReadAccess(user, doctype, name, doc._data);
    return this.actionRunner.getAvailableActions(entity, doc, user);
  }

  // ─── READ ──────────────────────────────────────────────

  /**
   * Read access = an RBAC read permission OR an explicit DocShare on this
   * specific document (D10b). The share is checked lazily — only when the
   * normal permission check denies — so the common path stays one check.
   */
  private async assertReadAccess(
    user: UserContext,
    doctype: string,
    name: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.permissionChecker.check(user, doctype, "read", data);
    } catch (err) {
      if (
        err instanceof PermissionDeniedError &&
        user.email &&
        (await this.documentShareService.hasShare(doctype, name, user.email, "read"))
      ) {
        return; // explicit share grants read on this doc
      }
      throw err;
    }
  }

  /**
   * Overlay per-document data translations onto a single document's data for the
   * given locale. Generic: only the entity's `translatable` fields that are
   * present are looked up; a missing translation keeps the stored value. No-op
   * (and no DB query) when there are no translatable fields or no locale.
   */
  private async applyDataTranslations(
    entity: EntityDefinition,
    name: string,
    data: Record<string, unknown>,
    locale: string | undefined,
  ): Promise<void> {
    if (!locale) return;
    const fields = this.registry.getTranslatableFields(entity.name);
    if (fields.length === 0) return;
    const present = fields.filter((f) => data[f] != null && data[f] !== "");
    if (present.length === 0) return;
    const tr = await this.translationService.resolveDocumentTranslations(
      entity.name,
      name,
      present,
      locale,
    );
    for (const [f, v] of Object.entries(tr)) {
      if (v != null && v !== "") data[f] = v;
    }
  }

  /** Batched data-translation overlay for a list (one query for all rows). */
  private async applyListDataTranslations(
    entity: EntityDefinition,
    docs: Record<string, unknown>[],
    locale: string | undefined,
  ): Promise<void> {
    if (!locale || docs.length === 0) return;
    const fields = this.registry.getTranslatableFields(entity.name);
    if (fields.length === 0) return;
    const names = docs.map((d) => String(d["_id"]));
    const map = await this.translationService.resolveListTranslations(
      entity.name,
      names,
      fields,
      locale,
    );
    if (map.size === 0) return;
    for (const doc of docs) {
      const tr = map.get(String(doc["_id"]));
      if (!tr) continue;
      for (const [f, v] of Object.entries(tr)) {
        if (v != null && v !== "") doc[f] = v;
      }
    }
  }

  async getDoc(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    locale?: string,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);

    // Permission check — an explicit DocShare grants read on this doc (D10b).
    await this.assertReadAccess(user, doctype, name);

    // Load from DB
    const dbTarget = entity.database;
    const raw = await this.db.findOne(entity.name, name, dbTarget);
    if (!raw) throw new NotFoundError(doctype, name);

    const doc = new BaseDocument(doctype, raw as Record<string, unknown>);
    this.deserializeFields(entity, doc);

    // Permission check on specific document (owner, condition, scope)
    await this.assertReadAccess(user, doctype, name, doc._data);

    // Role-visibility (e.g. Workspace): a role-restricted document the user may not
    // see is reported as not-found (same as RBAC elsewhere — don't leak its shape).
    if (!isRoleVisible(entity, user, doc._data)) {
      throw new NotFoundError(doctype, name);
    }

    // Apply per-document data translations for the request locale (translatable
    // fields only; falls back to the stored value). No-op when the entity has no
    // translatable fields or no locale was resolved.
    await this.applyDataTranslations(entity, name, doc._data, locale);

    // Resolve link titles (title is translated too when the target field is translatable)
    const linkTitles = await this.linkTitleResolver.resolve(entity, doc._data, locale);
    doc._link_titles = linkTitles;

    // Resolve status indicator
    const statusIndicator = resolveStatusIndicator(entity, doc._data);
    if (statusIndicator) doc._status_indicator = statusIndicator;

    // Filter fields by read permission
    const filteredData = this.permissionChecker.filterFieldsForRead(user, doctype, doc._data);
    doc._data = filteredData;

    // Log view
    if (entity.track_views) {
      this.safeBackground(this.viewLogService.logView(doctype, name, user.email), {
        operation: "viewLog",
        doctype,
        name,
      });
    }

    return doc;
  }

  async getList(
    doctype: string,
    query: ListQuery,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    locale?: string,
  ): Promise<ListResult> {
    const entity = this.registry.get(doctype);

    // Permission check
    await this.permissionChecker.check(user, doctype, "select");

    // Build base filter. P-SEC/R7: constrain caller-supplied filter/or_filter
    // field names to the entity's DECLARED surface (+ system fields + Table child
    // fields) and reject `$`-prefixed operator keys — blocks NoSQL operator
    // injection ($where/$expr) reachable via the public + resource list endpoints.
    const searchFields = entity.search_fields ?? [];
    // Coerce date/datetime filter VALUES to their stored form before building the
    // Mongo filter, so relative ($now ± duration → Date) and absolute (string) date
    // filters actually compare against stored date fields instead of silently
    // matching 0 rows (see filter-value-coercer). Field-type-metadata driven.
    const coercedQuery = {
      ...query,
      filters: coerceDateFilterValues(entity, query.filters),
      or_filters: coerceDateFilterValues(entity, query.or_filters),
    };
    const baseFilter = buildMongoFilter(coercedQuery, searchFields, this.buildFilterAllowlist(entity));

    // Apply scope filters (user permissions, if_owner) + role-visibility (entities
    // that declare role_visibility_field, e.g. Workspace — enumerate only what your
    // roles may see; Administrator bypasses both).
    const scopedFilter = applyRoleVisibilityFilter(
      entity,
      user,
      applyScopeFilters(
        entity,
        user,
        baseFilter as Record<string, unknown>,
        env.PERMISSION_SCOPE_ENABLED,
      ),
    );

    const defaultSort = entity.default_sort
      ? `${entity.default_sort.field} ${entity.default_sort.order}`
      : "modified desc";

    const sort = buildSort(query.order_by ?? defaultSort);
    const { limit, offset } = parsePagination(query);

    // D10b: surface documents explicitly shared with the user. They bypass the
    // scope restriction but still respect the search/query filter.
    let effectiveFilter = scopedFilter as Record<string, unknown>;
    const sharedIds = user.email
      ? await this.documentShareService.sharedDocumentIds(doctype, user.email, "read")
      : [];
    if (sharedIds.length > 0 && Object.keys(scopedFilter).length > 0) {
      const base = baseFilter as Record<string, unknown>;
      const sharedBranch =
        Object.keys(base).length > 0
          ? { $and: [base, { _id: { $in: sharedIds } }] }
          : { _id: { $in: sharedIds } };
      effectiveFilter = { $or: [scopedFilter as Record<string, unknown>, sharedBranch] };
    }

    const filterArray =
      Object.keys(effectiveFilter).length > 0 ? [effectiveFilter] : [];

    const dbTarget = entity.database;
    const [data, total] = await Promise.all([
      this.db.find(
        entity.name,
        {
          filters: filterArray,
          fields: query.fields,
          order_by: query.order_by ?? defaultSort,
          limit,
          offset,
        },
        dbTarget,
      ),
      this.db.count(entity.name, filterArray, dbTarget),
    ]);

    let docs = data as Record<string, unknown>[];
    let effectiveTotal = total;

    // C1: applyScopeFilters translates scope/if_owner into the Mongo filter, but
    // a permission `condition` is an arbitrary expression that cannot be — so the
    // enumeration query can return rows getDoc would 403. Re-check each row's read
    // permission (which evaluates `condition` fail-closed) and drop denied rows,
    // only when the user actually holds a conditional read grant (no cost otherwise).
    if (this.permissionChecker.hasConditionalReadPermission(user, doctype)) {
      const visible: Record<string, unknown>[] = [];
      for (const doc of docs) {
        if ((await this.permissionChecker.hasPermission(user, doctype, "read", doc)).allowed) {
          visible.push(doc);
        }
      }
      // Lower-bound correction: subtract rows dropped on this page. An exact total
      // would require scanning the whole collection; the security guarantee is that
      // no condition-hidden row appears in `data`.
      effectiveTotal = Math.max(0, total - (docs.length - visible.length));
      docs = visible;
    }

    // Apply per-document data translations (batched) for the request locale.
    await this.applyListDataTranslations(entity, docs, locale);

    // Resolve link titles (batch; titles translated when the target field is translatable)
    const titleMap = await this.linkTitleResolver.resolveForList(entity, docs, locale);
    for (const doc of docs) {
      const titles = titleMap.get(String(doc["_id"]));
      if (titles) {
        doc["_link_titles"] = titles;
      }
    }

    // Filter fields by read permission
    const filteredDocs = docs.map((doc) =>
      this.permissionChecker.filterFieldsForRead(user, doctype, doc),
    );

    const page = query.page ?? Math.floor(offset / limit) + 1;
    const page_size = limit;

    return {
      data: filteredDocs,
      total: effectiveTotal,
      page,
      page_size,
      total_pages: Math.ceil(effectiveTotal / page_size),
    };
  }

  async exists(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
  ): Promise<boolean> {
    const entity = this.registry.get(doctype);
    // Apply scope filter so users with restricted scope cannot probe
    // existence of out-of-scope documents (information leak).
    const scopedFilter = applyScopeFilters(
      entity,
      user,
      { _id: name },
      env.PERMISSION_SCOPE_ENABLED,
    );
    const hits = await this.db.count(entity.name, [scopedFilter], entity.database);
    if (hits === 0) return false;
    // C1: a `condition` read grant can't be a scope filter, so a scope-visible
    // row may still be condition-hidden. Re-check the specific doc.
    if (this.permissionChecker.hasConditionalReadPermission(user, doctype)) {
      const raw = await this.db.findOne(entity.name, name, entity.database);
      if (!raw) return false;
      return (
        await this.permissionChecker.hasPermission(
          user,
          doctype,
          "read",
          raw as Record<string, unknown>,
        )
      ).allowed;
    }
    return true;
  }

  /** The set of filter field names a list/count query may reference: the entity's
   *  declared fields + Table child fields + the standard system fields (P-SEC/R7). */
  private buildFilterAllowlist(entity: EntityDefinition): Set<string> {
    return new Set<string>([
      ...entity.fields.map((f) => f.fieldname),
      ...entity.fields
        .filter((f) => f.fieldtype === "Table")
        .flatMap((f) => f.child_fields?.map((c) => c.fieldname) ?? []),
      "_id", "doctype", "docstatus", "owner", "modified_by", "creation", "modified",
      "idx", "parent", "parenttype", "parentfield",
    ]);
  }

  async count(
    doctype: string,
    filters?: Record<string, unknown>[],
    user: UserContext = GUEST_USER,
  ): Promise<number> {
    const entity = this.registry.get(doctype);
    // P-SEC: count is a sibling of getList and must enforce the SAME gates — an
    // authenticated external user reaches this endpoint too. Require `select`, and
    // validate every caller-supplied filter KEY against the entity's declared
    // surface (rejecting `$`-prefixed operator keys), so count cannot become a
    // NoSQL-operator-injection / blind-exfiltration oracle (R7). The count path
    // takes object-form filters (merged verbatim), so the getList allow-list —
    // wired into buildMongoFilter for tuple-form — must be applied here explicitly.
    await this.permissionChecker.check(user, doctype, "select");
    const allowed = this.buildFilterAllowlist(entity);
    // Apply scope filter so users with restricted scope only count
    // their own visible rows, not the global total.
    const merged: Record<string, unknown> = {};
    for (const f of filters ?? []) {
      for (const key of Object.keys(f ?? {})) assertFieldAllowed(key, allowed);
      Object.assign(merged, f);
    }
    // Gate scope on PERMISSION_SCOPE_ENABLED exactly like getList/exists — otherwise
    // count() over-enforces: a scope-only reader lacking the scope claim would get
    // count=0 while getList shows every row (fail-closed inconsistency).
    const scopedFilter = applyScopeFilters(entity, user, merged, env.PERMISSION_SCOPE_ENABLED);
    // C1: a `condition` read grant cannot be a Mongo filter, so count only the
    // condition-visible rows by loading the scope-visible set and re-checking each.
    // Costlier, but only when the user holds a conditional read grant.
    if (this.permissionChecker.hasConditionalReadPermission(user, doctype)) {
      const rows = (await this.db.find(
        entity.name,
        { filters: [scopedFilter] },
        entity.database,
      )) as Record<string, unknown>[];
      let n = 0;
      for (const row of rows) {
        if ((await this.permissionChecker.hasPermission(user, doctype, "read", row)).allowed) n++;
      }
      return n;
    }
    return this.db.count(entity.name, [scopedFilter], entity.database);
  }

  /**
   * Pre-flight period-close check. Returns whether the doc's effective date
   * falls into a closed period (or has no covering period at all). Used by
   * the FE to surface a "period closed" banner before the user clicks submit
   * the actual block still happens in `assertPeriodOpen` during submit.
   *
   * Returns `{ checked: false }` when the entity has no `period_check`.
   */
  async getPeriodStatus(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
  ): Promise<
    | { checked: false }
    | { checked: true; closed: false }
    | { checked: true; closed: true; period_id: string | null; period_entity: string }
    | { checked: true; closed: true; reason: "no_matching_period"; period_entity: string }
    | { checked: true; closed: true; reason: "ambiguous_period"; period_entity: string }
    | {
        checked: true;
        closed: true;
        reason: "date_outside_period";
        period_id: string | null;
        period_entity: string;
      }
  > {
    const entity = this.registry.get(doctype);
    if (!entity.period_check || !this.periodCloseValidator) {
      return { checked: false };
    }
    // Read permission — both at the entity level (gates probing for any
    // existence) and on the loaded doc (gates owner / scope filters).
    // Without this check the endpoint leaked existence and period state
    // to anyone authenticated, regardless of read permission.
    await this.permissionChecker.check(user, doctype, "read");
    const doc = await this.loadDocInternal(doctype, name);
    await this.permissionChecker.check(user, doctype, "read", doc._data);
    try {
      // Probe with the "submit" phase since that's the most-restrictive
      // default — surfaces closures the user would hit at submit time.
      await this.periodCloseValidator.assertPeriodOpen(entity, doc._data, "submit");
      return { checked: true, closed: false };
    } catch (err: unknown) {
      const e = err as { name?: string; periodId?: string | null; periodEntity?: string };
      if (e?.name === "PeriodClosedError") {
        return {
          checked: true,
          closed: true,
          period_id: e.periodId ?? null,
          period_entity: e.periodEntity ?? entity.period_check.period_entity,
        };
      }
      if (e?.name === "NoMatchingPeriodError") {
        return {
          checked: true,
          closed: true,
          reason: "no_matching_period",
          period_entity: e.periodEntity ?? entity.period_check.period_entity,
        };
      }
      // Overlapping fiscal calendar — REPORT the misconfiguration instead of
      // letting AmbiguousPeriodError rethrow into a 500.
      if (e?.name === "AmbiguousPeriodError") {
        return {
          checked: true,
          closed: true,
          reason: "ambiguous_period",
          period_entity: e.periodEntity ?? entity.period_check.period_entity,
        };
      }
      // The doc's date falls outside its explicitly-referenced period. This is a
      // blocking condition the preflight should REPORT, not 500 on (the old
      // behavior — DateOutsidePeriodError was uncaught here and unmapped by the
      // error handler).
      if (e?.name === "DateOutsidePeriodError") {
        return {
          checked: true,
          closed: true,
          reason: "date_outside_period",
          period_id: e.periodId ?? null,
          period_entity: e.periodEntity ?? entity.period_check.period_entity,
        };
      }
      throw err;
    }
  }

  // ─── INSERT ────────────────────────────────────────────

  /**
   * Resolve a DRAFT document like insert would — defaults, fetch_from, field
   * serialization, and computed hooks — but WITHOUT persisting, validating, or
   * running write/lifecycle hooks. Returns the computed doc (totals, line_total,
   * derived fields) so the frontend can show live computed values for an unsaved
   * draft. Computed hooks run with no session, so nothing is written.
   */
  async preview(
    doctype: string,
    data: Record<string, unknown>,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);

    // Least-privilege gate: previewing computed values requires read access.
    await this.permissionChecker.check(user, doctype, "select");

    // Same prep as insert (minus workflow stamping): strip non-writable fields,
    // resolve defaults + fetch_from, serialize.
    const writeData = this.permissionChecker.filterFieldsForWrite(user, doctype, data);
    let processed = resolveDefaults(entity, writeData, user.email, user.full_name);
    processed = await this.fetchFromResolver.resolve(entity, processed);
    const serialized = this.serializeFields(entity, processed);

    const doc = new BaseDocument(doctype);
    doc._data = { ...serialized };
    doc._isNew = true;
    doc.ensureRowIds();

    // Computed hooks only, NO session → in-memory, never persisted.
    await this.hookRunner.runComputedHooks(doctype, doc, ctx, undefined, user);

    // Live-preview merges replace parts of the form doc — they need the same
    // link titles as the read paths or a recompute wipes the visible labels.
    doc._link_titles = await this.linkTitleResolver.resolve(entity, doc._data);

    return doc;
  }

  /**
   * Resolve THE row of an `is_single` entity without the caller knowing its
   * `_id` (singles have no naming convention — `Setting` is `"settings"`,
   * branding is a random id). Goes through `getList` so the standard list
   * permission + field-stripping apply. Throws `NotFoundError` when the single
   * has not been initialized yet (the engine seeds singles — an empty single is
   * a seeding gap, surfaced loudly rather than masked). The `is_single` guard
   * itself lives at the route layer (it owns the registry + the 400 response).
   */
  async getSingle(
    doctype: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    locale?: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.getList(doctype, { page_size: 1 }, user, ctx, locale);
    const row = result.data[0];
    if (!row) {
      throw new NotFoundError(doctype, "(single — not initialized)");
    }
    return row;
  }

  async insert(
    doctype: string,
    data: Record<string, unknown>,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    /** When provided, the insert joins the caller's transaction instead of
     * opening its own. Used by the Rule Engine so rule-created documents
     * roll back with their triggering submit. */
    sessionOverride?: import("mongodb").ClientSession,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);

    log.debug({ doctype, user: user.email }, "Insert started");

    // Permission check — rule-created docs still obey the triggering user's perms.
    await this.permissionChecker.check(user, doctype, "create");

    // Write-field-level permissions: strip fields the user may not write
    // (perm_level / read_only) from the raw input BEFORE defaults / fetch_from /
    // computed fill in — those are system-set and must not be filtered.
    const writeData = this.permissionChecker.filterFieldsForWrite(user, doctype, data);

    // Resolve defaults
    let processed = resolveDefaults(entity, writeData, user.email, user.full_name);

    // Stamp the initial workflow state when caller didn't supply one. The
    // workflow field defaults to `status`. Coexists with docstatus.
    if (this.workflowEngine && this.workflowEngine.hasWorkflow(entity)) {
      const wf = this.workflowEngine.getWorkflowField(entity);
      if (processed[wf] === undefined || processed[wf] === null || processed[wf] === "") {
        const initial = this.workflowEngine.getInitialState(entity);
        if (initial !== undefined) {
          processed[wf] = initial;
        }
      }
    }

    // Fetch-from (auto-fill from linked docs)
    processed = await this.fetchFromResolver.resolve(entity, processed);

    // Serialize fields
    const serialized = this.serializeFields(entity, processed);

    // Build document for hooks
    const doc = new BaseDocument(doctype);
    doc._data = { ...serialized };
    doc._isNew = true;
    // Stamp _row_id on every Table-row so sub-row Links (target_path)
    // can resolve any row inserted via raw-data assignment, not just
    // those added via addChild. Without this, fixtures that pass
    // `addresses: [...]` to insert() lose the row_id and break sub-row
    // Link resolution / fetch_from / target_path resolvers.
    doc.ensureRowIds();

    // Wrap the entire mutating block — computed/validate hooks, validation,
    // link/period checks, before_insert, naming, write, and after_insert/
    // on_change — in a transaction so any hook DB write rolls back with the
    // insert on failure. Hooks receive `session` via the merged services.
    // OR join the caller's existing session when supplied (rule-engine path).
    const runInsert = async (session: import("mongodb").ClientSession) => {
      // Run computed field hooks
      await this.hookRunner.runComputedHooks(doctype, doc, ctx, session, user);

      // Run validate hook
      await this.hookRunner.run(doctype, "validate", doc, ctx, session, user);
      if (this.ruleEngine) {
        // validate rules fire on BOTH insert and update, before Zod. A set_value
        // here lands in doc._data (Zod-validated below). NB: naming runs later,
        // so doc._id/business-key are still empty on insert — create_document
        // rules that back-reference the trigger belong on before_submit/on_submit.
        const ruleMutations = await this.ruleEngine.execute(
          doctype,
          "validate",
          doc._data,
          user,
          session,
        );
        for (const f of Object.keys(ruleMutations ?? {})) doc._dirty.add(f);
      }

      // Entity schema validation (Zod-driven shape + field constraints +
      // row-uniqueness; replaces the hand-rolled per-field validator).
      const validation = validateEntityDataZod(entity, doc._data, this.zodSchemaBuilder, true);
      if (!validation.valid) {
        for (const err of validation.errors) {
          ctx?.error(err.message_key, err.params);
        }
        throw new ValidationFailedError(doctype, validation.errors);
      }

      // Link validation
      const linkErrors = await this.linkValidator.validate(entity, doc._data, session);
      if (linkErrors.length > 0) {
        for (const err of linkErrors) {
          ctx?.error(err.message_key, err.params);
        }
        throw new ValidationFailedError(
          doctype,
          linkErrors.map((e) => ({
            field: e.field,
            message_key: e.message_key,
            params: e.params,
          })),
        );
      }

      // Period-close enforcement (insert phase). Throws PeriodClosedError when
      // the doc's effective date falls into a closed accounting/calendar period
      // AND the entity's period_check.block_on includes "insert".
      if (this.periodCloseValidator) {
        await this.periodCloseValidator.assertPeriodOpen(entity, doc._data, "insert", session);
      }

      await this.hookRunner.run(doctype, "before_insert", doc, ctx, session, user);

      // Populate a generated document number (the business_key field) from its
      // series expression — e.g. doc_no = "DOC-2026-00001". Runs AFTER
      // before_insert (not before validation, as it used to) so a stamp/default
      // before_insert hook can populate a field the series expression
      // partitions on (e.g. `{####:<partition_field>}`) before the series is
      // generated — a before_insert-only default would otherwise leave that
      // partition field empty at naming time. _id stays a system ObjectId; the
      // human number lives in the field, generated from the same sequence the
      // old _id expression used (numbering continuity).
      if (typeof entity.business_key === "string" && entity.business_key_series) {
        const bkField = entity.business_key;
        if (doc._data[bkField] == null || doc._data[bkField] === "") {
          doc._data[bkField] = await this.namingService.generateSeries(
            entity,
            entity.business_key_series,
            doc._data,
            session,
          );
        }
      }

      // Generate _id (pass original data for user_set naming which reads _id)
      const _id = await this.namingService.generateId(entity, { ...doc._data, ...data }, session);

      // Set standard fields. _id is kept as a string in memory (a native ObjectId
      // from `system` naming → its 24-hex string); toMongo converts it back.
      const now = new Date();
      doc._id = toIdString(_id);
      doc.doctype = doctype;
      doc.docstatus = 0;
      doc.owner = user.email;
      doc.modified_by = user.email;
      doc.creation = now;
      doc.modified = now;

      // Store in DB
      await this.db.insertOne(entity.name, doc.toMongo(), entity.database, session);

      await this.hookRunner.run(doctype, "after_insert", doc, ctx, session, user);
      await this.hookRunner.run(doctype, "on_change", doc, ctx, session, user);

      // Activity log — inside the transaction so a failed hook rolls
      // back the log entry too (no false-positive audit trail entries).
      await this.activityLogService.log(
        {
          entity: doctype,
          document_name: doc._id,
          action: "Created",
          user: user.email,
          user_name: user.full_name ?? user.email,
        },
        session,
      );
    };
    if (sessionOverride) {
      await runInsert(sessionOverride);
    } else {
      await this.db.withTransaction(runInsert);
    }

    ctx?.success("doc_created", {
      doctype: entity.label ?? doctype,
      name: doc._id,
    });

    log.info(
      { doctype, name: doc._id, user: user.email },
      "Document inserted",
    );

    // The response is what the form resets to — without titles every Link
    // field would regress to its raw id until a full reload (getDoc/getList
    // resolve them; the write paths must too).
    doc._link_titles = await this.linkTitleResolver.resolve(entity, doc._data);

    return doc;
  }

  // ─── UPDATE ────────────────────────────────────────────

  async update(
    doctype: string,
    name: string,
    data: Record<string, unknown>,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    /**
     * Skip the standard `write` permission check. Used by the workflow
     * transition path: `WorkflowEngine.validateTransition` enforces
     * `transitions[].allowed_roles` separately, so a user authorised only
     * for a specific transition (but not generic write) can still flip
     * the workflow state. Other callers should NOT pass this — the
     * transition path is the only legitimate use.
     */
    options: { skipWritePermCheck?: boolean; expectedModified?: string } = {},
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);

    // Load existing
    const doc = await this.loadDocInternal(doctype, name);

    // Snapshot attach-field file ids BEFORE the merge — so a save that clears or
    // replaces a file can delete the now-orphaned File (reference-counted) once
    // it commits.
    const attachFilesBefore = this.storage ? collectAttachFileIds(entity.fields, doc._data) : [];

    // Permission check (skipped on transition path — see options doc above)
    if (!options.skipWritePermCheck) {
      await this.permissionChecker.check(user, doctype, "write", doc._data);
    }

    // Optimistic concurrency: when the caller sent the version it last saw
    // (If-Match), reject if the stored doc has advanced since — prevents a
    // stale edit silently clobbering a concurrent write. Opt-in: callers that
    // omit `expectedModified` keep last-write-wins (service-to-service, tests).
    if (options.expectedModified) {
      const actual = doc.modified.toISOString();
      if (actual !== options.expectedModified) {
        throw new ConcurrentModificationError(doctype, name, options.expectedModified, actual);
      }
    }

    // Write-field-level permissions: drop fields the user may not write
    // (perm_level / read_only). Skipped on the transition path, which is gated
    // separately by allowed_roles — filtering there would strip the status flip.
    const writeData = options.skipWritePermCheck
      ? data
      : this.permissionChecker.filterFieldsForWrite(user, doctype, data, doc._data);

    // Check if editable
    this.docStatusEngine.validateEdit(entity, doc);

    // Time-series collections are append-only apart from limited meta_field
    // modifications. Reject any patch that touches non-meta fields.
    if (entity.time_series) {
      const metaField = entity.time_series.meta_field;
      const attempted = Object.keys(data).filter((k) => !k.startsWith("_") && k !== metaField);
      if (attempted.length > 0) {
        throw new TimeSeriesImmutableError(doctype, attempted, metaField);
      }
    }

    // Workflow transition validation. Detect a change to the workflow field
    // (default `status`). The actual side_effects + on_workflow_transition
    // rule fire INSIDE the transaction below. We capture the from/to here
    // so the transition is gated outside the write critical section.
    let pendingTransition: {
      from: string | undefined;
      to: string;
      transition: TransitionDefinition | undefined;
    } | null = null;
    if (this.workflowEngine && this.workflowEngine.hasWorkflow(entity)) {
      const wf = this.workflowEngine.getWorkflowField(entity);
      if (Object.prototype.hasOwnProperty.call(data, wf)) {
        const from = doc._data[wf] as string | undefined;
        const to = data[wf];
        if (typeof to === "string" && from !== to) {
          const authorizedTransition = this.workflowEngine.validateTransition(
            entity,
            doc._data,
            from,
            to,
            user,
          );
          pendingTransition = { from, to, transition: authorizedTransition };
        }
      }
    }

    if (entity.is_log) {
      throw new DocStatusError("cannot_edit_log", { doctype: entity.name });
    }

    // Apply child-field defaults to NEWLY-ADDED child rows (matched by absence
    // of their _row_id in the loaded original) — parity with insert; existing
    // rows and header fields are left untouched. Runs before serialize so
    // Date/Datetime child defaults serialize correctly.
    applyNewChildRowDefaults(entity, writeData, doc._original, user.email, user.full_name);

    // Serialize and merge changes (writeData = permission-filtered input)
    const serialized = this.serializeFields(entity, writeData);
    doc.merge(serialized);

    // Check set_only_once fields
    for (const field of entity.fields) {
      if (field.set_only_once && doc.hasChanged(field.fieldname)) {
        const originalValue = doc.getPreviousValue(field.fieldname);
        if (originalValue !== null && originalValue !== undefined && originalValue !== "") {
          ctx?.error("field_set_only_once", { field: field.label });
          throw new ValidationFailedError(doctype, [
            {
              field: field.fieldname,
              message_key: "field_set_only_once",
              params: { field: field.label },
            },
          ]);
        }
      }
    }

    // Fetch-from for changed link fields
    const changedFields = doc.getChangedFields();
    const hasChangedLinks = entity.fields.some(
      (f) => f.fieldtype === "Link" && changedFields.includes(f.fieldname),
    );
    if (hasChangedLinks) {
      const fetched = await this.fetchFromResolver.resolve(entity, doc._data);
      doc.merge(fetched);
    }

    // Wrap field-change/computed/validate/Zod/link/period + before_save +
    // write + on_update/on_change in a single transaction so any hook DB
    // write rolls back with the parent on failure. Hooks receive `session`
    // via merged services (`HookRunner.run/runFieldChangeHooks/runComputedHooks`).
    await this.db.withTransaction(async (session) => {
      // Run field change hooks (transactional)
      await this.hookRunner.runFieldChangeHooks(doctype, doc, changedFields, ctx, session, user);

      // Run computed field hooks (transactional)
      await this.hookRunner.runComputedHooks(doctype, doc, ctx, session, user);

      // Run validate hook
      await this.hookRunner.run(doctype, "validate", doc, ctx, session, user);
      if (this.ruleEngine) {
        // validate rules fire before Zod. This is where a set_value mutation is
        // Zod-validated AND persisted (via _dirty.add → getChanges() below).
        const ruleMutations = await this.ruleEngine.execute(
          doctype,
          "validate",
          doc._data,
          user,
          session,
        );
        for (const f of Object.keys(ruleMutations ?? {})) doc._dirty.add(f);
      }

      // Entity schema validation (Zod-driven; same code path as insert).
      const validation = validateEntityDataZod(entity, doc._data, this.zodSchemaBuilder, false);
      if (!validation.valid) {
        for (const err of validation.errors) {
          ctx?.error(err.message_key, err.params);
        }
        throw new ValidationFailedError(doctype, validation.errors);
      }

      // Link validation
      const linkErrors = await this.linkValidator.validate(entity, doc._data, session);
      if (linkErrors.length > 0) {
        for (const err of linkErrors) {
          ctx?.error(err.message_key, err.params);
        }
        throw new ValidationFailedError(
          doctype,
          linkErrors.map((e) => ({
            field: e.field,
            message_key: e.message_key,
            params: e.params,
          })),
        );
      }

      // Period-close enforcement (update phase). Only runs when the entity
      // declares period_check.block_on includes "update" — defaults exclude
      // it so amendment workflows can still edit drafts in closed periods.
      if (this.periodCloseValidator) {
        await this.periodCloseValidator.assertPeriodOpen(entity, doc._data, "update", session);
      }

      await this.hookRunner.run(doctype, "before_save", doc, ctx, session, user);
      if (this.ruleEngine) {
        // before_save rules see pre-transition state. This is post-Zod, so a
        // set_value here is rejected by the engine's event gate (fail loud).
        await this.ruleEngine.execute(doctype, "before_save", doc._data, user, session);
      }

      // Apply workflow transition side-effects + fire the rule event,
      // INSIDE the transaction so child writes roll back on failure.
      // applyTransition RETURNS the side_effects.set map (it no longer mutates
      // doc._data) — merge it so the fields enter _dirty and getChanges()
      // actually persists them.
      if (pendingTransition && this.workflowEngine) {
        const sideEffects = await this.workflowEngine.applyTransition(
          entity,
          doc._data,
          pendingTransition.transition,
          pendingTransition.from,
          pendingTransition.to,
          user,
          session,
        );
        doc.merge(sideEffects);
      }

      // Update metadata
      doc.modified = new Date();
      doc.modified_by = user.email;

      // Save to DB
      await this.db.updateOne(
        entity.name,
        name,
        {
          ...doc.getChanges(),
          modified: doc.modified,
          modified_by: doc.modified_by,
        },
        entity.database,
        session,
      );

      await this.hookRunner.run(doctype, "on_update", doc, ctx, session, user);
      if (this.ruleEngine) {
        // on_update rules fire post-write. set_value is rejected here (post-write
        // event) by the engine's gate.
        await this.ruleEngine.execute(doctype, "on_update", doc._data, user, session);
      }
      await this.hookRunner.run(doctype, "on_change", doc, ctx, session, user);

      // Version tracking — inside the transaction so a hook failure
      // rolls back the version entry too.
      if (entity.track_changes) {
        await this.versionService.createVersion(doc, user.email, session);
      }

      // Activity log — likewise transactional.
      await this.activityLogService.log(
        {
          entity: doctype,
          document_name: name,
          action: "Updated",
          user: user.email,
          user_name: user.full_name ?? user.email,
          details: { changed_fields: changedFields },
        },
        session,
      );
    });

    // Reference-counted cleanup of files this save removed or replaced
    // (post-commit, best-effort — a storage hiccup must never fail the save).
    // doc._data now holds the new values; any file present before but gone now
    // is an orphan.
    if (this.storage && attachFilesBefore.length > 0) {
      const after = new Set(collectAttachFileIds(entity.fields, doc._data));
      for (const fileId of attachFilesBefore) {
        if (after.has(fileId)) continue;
        try {
          await deleteFileRefCounted(this.db, this.storage, fileId);
        } catch (err) {
          log.warn({ doctype, name, fileId, err }, "Attachment cleanup failed on update");
        }
      }
    }

    ctx?.success("doc_saved", {
      doctype: entity.label ?? doctype,
      name,
    });

    log.info({ doctype, name, user: user.email, changes: changedFields }, "Document updated");

    // Same contract as insert: the save response carries the link titles the
    // form needs to keep displaying labels instead of raw ids.
    doc._link_titles = await this.linkTitleResolver.resolve(entity, doc._data);

    return doc;
  }

  // ─── UPDATE (POST-SUBMIT) ──────────────────────────────
  //
  // The ONLY sanctioned way to mutate a submitted (docstatus=1) document.
  // `update()` hard-blocks docstatus 1/2; this narrow verb admits ONLY the
  // fields an entity explicitly flags `allow_on_submit` (settlement counters,
  // status, post-submit annotations), runs a reduced-but-real pipeline
  // (permission → band gate → serialize → computed refresh → Zod → link →
  // period-close → narrow hooks → write → version → activity), and leaves the
  // frozen business core physically unreachable: draft-era validate /
  // before_save / field-change hooks NEVER fire on this path. Declared
  // `hooks.computed` DO re-run (D5) so derived fields (header rollups over
  // band counters, settlement remainders) stay equal to the computation of
  // their inputs — but their writes are fenced: only declared computed target
  // fields (plus the band itself) may effectively change; any other effective
  // change a computed hook attempts aborts in the closing band guardrail.
  async updateSubmitted(
    doctype: string,
    name: string,
    patch: SubmittedPatch,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    options: {
      /** Join the caller's transaction — same contract as submit()/cancel(). */
      sessionOverride?: import("mongodb").ClientSession;
      /** If-Match optimistic concurrency, mirror update(). */
      expectedModified?: string;
      /**
       * Skip the target-doctype write check. Sanctioned for exactly two caller
       * classes: (a) `transition()` — `transitions[].allowed_roles` is the gate;
       * (b) lifecycle hooks running inside a governed parent verb whose RBAC
       * already passed (e.g. `Payment.on_submit` settling a `SalesInvoice`).
       * The activity log always records the real actor + `cause`.
       */
      skipWritePermCheck?: boolean;
      /** Audit provenance: the doc whose lifecycle caused this write. */
      cause?: { doctype: string; name: string };
      /** @internal `transition()` only — admits the workflow field into the band. */
      allowWorkflowField?: boolean;
    } = {},
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);
    if (entity.is_log) {
      throw new DocStatusError("cannot_edit_log", { doctype: entity.name });
    }

    // Pre-transaction load — needed for the permission check + fast band
    // pre-validation. Joins the caller's session so a doc written earlier in
    // that transaction is visible.
    const preDoc = await this.loadDocInternal(doctype, name, options.sessionOverride);

    if (!options.skipWritePermCheck) {
      await this.permissionChecker.check(user, doctype, "write", preDoc._data);
    }
    if (options.expectedModified) {
      const actual = preDoc.modified.toISOString();
      if (actual !== options.expectedModified) {
        throw new ConcurrentModificationError(doctype, name, options.expectedModified, actual);
      }
    }

    const touched = {
      setFields: Object.keys(patch.set ?? {}),
      incrementFields: Object.keys(patch.increment ?? {}),
      children: (patch.children ?? []).map((c) => ({
        table: c.table,
        setFields: Object.keys(c.set ?? {}),
        incrementFields: Object.keys(c.increment ?? {}),
      })),
    };
    this.docStatusEngine.validateSubmittedPatch(entity, preDoc, touched, {
      allowWorkflowField: options.allowWorkflowField,
    });

    // The workflow field. A band-flagged workflow field set by a hook (e.g.
    // status="paid" on settlement) is a plain band write; only the transition
    // path (allowWorkflowField) runs validateTransition. The pending transition
    // is resolved INSIDE the tx against the reloaded/committed state (below), not
    // here — so a withTransaction retry re-validates from the current state.
    const workflowField = entity.workflow_field ?? "status";

    let resultDoc = preDoc;
    const runPostSubmitUpdate = async (session: import("mongodb").ClientSession) => {
      // H7: outside sessionOverride, RE-LOAD under the session so increments
      // read-modify-write against the COMMITTED value — a withTransaction retry
      // after a Mongo write conflict then recomputes correctly (never resolve an
      // increment against the pre-tx read). Re-validate the band on the reload.
      const doc = options.sessionOverride
        ? preDoc
        : await this.loadDocInternal(doctype, name, session);
      if (!options.sessionOverride) {
        this.docStatusEngine.validateSubmittedPatch(entity, doc, touched, {
          allowWorkflowField: options.allowWorkflowField,
        });
      }
      resultDoc = doc;

      // Clean dirty baseline: only the fields we touch below should be written
      // and versioned (a fresh load starts non-dirty; belt-and-suspenders).
      doc._dirty.clear();

      // Optimistic concurrency re-check against the COMMITTED doc, INSIDE the tx
      // (the pre-tx check at the top is a fast-fail; this closes the window where
      // a competing write commits between the pre-load and this transaction).
      if (options.expectedModified && doc.modified.toISOString() !== options.expectedModified) {
        throw new ConcurrentModificationError(
          doctype,
          name,
          options.expectedModified,
          doc.modified.toISOString(),
        );
      }

      // Resolve the pending transition against the (reloaded) committed workflow
      // state so a withTransaction retry — or a competing transition that
      // committed since the pre-load — re-validates from the CURRENT state
      // instead of a stale pre-tx from-value.
      let pendingTransition: {
        from: string | undefined;
        to: string;
        transition: TransitionDefinition | undefined;
      } | null = null;
      if (
        options.allowWorkflowField &&
        this.workflowEngine &&
        this.workflowEngine.hasWorkflow(entity) &&
        patch.set &&
        Object.prototype.hasOwnProperty.call(patch.set, workflowField)
      ) {
        const from = doc._data[workflowField] as string | undefined;
        const to = patch.set[workflowField];
        if (typeof to === "string" && from !== to) {
          const authorized = this.workflowEngine.validateTransition(
            entity,
            doc._data,
            from,
            to,
            user,
          );
          pendingTransition = { from, to, transition: authorized };
        }
      }

      const childChanges: FieldChange[] = [];
      const touchedTables = new Set<string>();

      // Top-level increments — read-modify-write under the tx.
      for (const [f, delta] of Object.entries(patch.increment ?? {})) {
        doc.set(f, Number(doc.get(f) ?? 0) + Number(delta));
      }

      // Children — per-row set/increment, addressed by _row_id.
      for (const entry of patch.children ?? []) {
        const row = doc.getChildById(entry.table, entry.row_id);
        if (!row) {
          throw new DocStatusError("missing_child_row", {
            doctype,
            table: entry.table,
            row_id: entry.row_id,
          });
        }
        const rowPatch: Record<string, unknown> = { ...(entry.set ?? {}) };
        for (const [cf, delta] of Object.entries(entry.increment ?? {})) {
          rowPatch[cf] = Number(row[cf] ?? 0) + Number(delta);
        }
        for (const [cf, val] of Object.entries(rowPatch)) {
          childChanges.push({
            field: `${entry.table}[${entry.row_id}].${cf}`,
            old: row[cf] ?? null,
            new: val ?? null,
          });
        }
        doc.updateChildById(entry.table, entry.row_id, rowPatch);
        touchedTables.add(entry.table);
      }
      // Normalize each touched table through serializeFields (mirror the draft
      // merge path). NOTE: the Table handler's toStorage is currently a
      // passthrough — child cells are not per-cell serialized on ANY path,
      // draft or post-submit — so this matches draft behavior exactly; it is
      // future-proofing, not an active per-cell conversion. updateChildById
      // already marked the table dirty.
      for (const table of touchedTables) {
        const serialized = this.serializeFields(entity, { [table]: doc.get(table) });
        if (serialized[table] !== undefined) doc.set(table, serialized[table]);
      }

      // Top-level set — serialized like the draft path.
      if (patch.set && Object.keys(patch.set).length > 0) {
        doc.merge(this.serializeFields(entity, patch.set));
      }

      // ── Post-submit computed refresh (D5) ──
      // Re-run the entity's declared computed hooks on the JUST-patched data so
      // every derived field is recomputed — restoring the invariant "a computed
      // field always equals the computation of its inputs", which a band write
      // would otherwise break (e.g. a line's allow_on_submit counter bumps but
      // the computed header rollup keeps its submit-era value). Placement
      // mirrors the draft update path exactly (computed → Zod), so Zod
      // validates the recomputed values; runs inside the same transaction.
      //
      // Frozen-core preservation — the reason this path historically skipped
      // ALL draft-era hooks: a computed handler can write arbitrary fields.
      // Two fences keep the core frozen:
      //   1. Only DECLARED computed target fields (`entity.hooks.computed`
      //      keys) join the closing band guardrail's allowed set below.
      //      Computed fields are read-only derived outputs, so recomputing
      //      them is safe by construction; callers still cannot set them
      //      directly (validateSubmittedPatch knows nothing of them).
      //   2. Every OTHER field a computed handler touches must be a
      //      value-level no-op, judged in CANONICAL storage form. Two classes
      //      of phantom change are cleaned up rather than punished:
      //        • object-likes — BaseDocument.set pessimistically marks them
      //          dirty even when the content is unchanged (see
      //          base-document.ts set()), e.g. a totals handler that re-sets
      //          its `lines` array with identical recomputed values. We
      //          deep-snapshot the clean object-like fields before the run
      //          and compare after.
      //        • type-flapping primitives — hook code habitually writes raw
      //          values (a Check as 0/1) while the stored form is serialized
      //          (Boolean); neither draft nor submit re-serializes hook
      //          outputs, so both representations exist in the wild. Both
      //          sides go through the field serializer before comparing, and
      //          a no-op keeps the STORED representation.
      //      A GENUINE change to a non-band, non-computed field stays dirty
      //      and aborts in the guardrail (fail loud: the handler effectively
      //      tried to mutate the frozen core post-submit — declare the field
      //      under hooks.computed, or make the handler idempotent over frozen
      //      inputs).
      const computedTargets = new Set(Object.keys(entity.hooks?.computed ?? {}));
      if (computedTargets.size > 0) {
        const dirtyBefore = new Set(doc.getChangedFields());
        // Snapshot only clean object-like values: primitives compare against
        // _original (top-level shallow copy = faithful for primitives), and
        // already-dirty fields are band-legal patch writes by construction.
        // structuredClone because handlers mutate child rows IN PLACE before
        // re-setting the array (the _original entry shares that reference).
        const preRunSnapshots = new Map<string, unknown>();
        for (const [k, v] of Object.entries(doc._data)) {
          if (!dirtyBefore.has(k) && v !== null && typeof v === "object") {
            preRunSnapshots.set(k, structuredClone(v));
          }
        }
        await this.hookRunner.runComputedHooks(doctype, doc, ctx, session, user);
        const canonical = (f: string, val: unknown): unknown =>
          val === undefined ? undefined : this.serializeFields(entity, { [f]: val })[f];
        for (const f of doc.getChangedFields()) {
          if (dirtyBefore.has(f) || computedTargets.has(f)) continue;
          const v = doc._data[f];
          if (v !== null && typeof v === "object") {
            if (preRunSnapshots.has(f) && deepEqual(v, preRunSnapshots.get(f))) {
              doc._dirty.delete(f); // pessimistic object-like dirty; value unchanged
            }
          } else if (deepEqual(canonical(f, v), canonical(f, doc._original[f]))) {
            doc._data[f] = doc._original[f]; // keep the stored representation
            doc._dirty.delete(f); // representation flap; value unchanged
          }
        }
      }

      // Zod (same code path as insert/update).
      const validation = validateEntityDataZod(entity, doc._data, this.zodSchemaBuilder, false);
      if (!validation.valid) {
        for (const err of validation.errors) ctx?.error(err.message_key, err.params);
        throw new ValidationFailedError(doctype, validation.errors);
      }

      // Link validation — ONLY when a touched field is a Link. Validating the
      // whole doc on every settlement bump would pay N link lookups per patch and,
      // worse, a FROZEN Link whose target drifted out of its filter (e.g. a
      // salesperson deactivated after submit) would block every post-submit patch.
      const touchedTop = [...touched.setFields, ...touched.incrementFields];
      const anyLinkTouched =
        entity.fields.some(
          (f) => f.fieldtype === "Link" && touchedTop.includes(f.fieldname),
        ) ||
        (patch.children ?? []).some((c) => {
          const tf = entity.fields.find((f) => f.fieldname === c.table);
          const cfs = tf?.child_fields ?? [];
          const cells = [...Object.keys(c.set ?? {}), ...Object.keys(c.increment ?? {})];
          return cells.some(
            (cell) => cfs.find((x) => x.fieldname === cell)?.fieldtype === "Link",
          );
        });
      if (anyLinkTouched) {
        const linkErrors = await this.linkValidator.validate(entity, doc._data, session);
        if (linkErrors.length > 0) {
          for (const err of linkErrors) ctx?.error(err.message_key, err.params);
          throw new ValidationFailedError(
            doctype,
            linkErrors.map((e) => ({ field: e.field, message_key: e.message_key, params: e.params })),
          );
        }
      }

      // Period-close — the dedicated `post_submit_update` phase. Default-excluded:
      // an entity seals post-submit patches into closed periods only by listing
      // "post_submit_update" in period_check.block_on, INDEPENDENTLY of "update".
      if (this.periodCloseValidator) {
        await this.periodCloseValidator.assertPeriodOpen(
          entity,
          doc._data,
          "post_submit_update",
          session,
        );
      }

      // Narrow invariant-guard hook. Draft-era validate/before_save/
      // field-change hooks deliberately do NOT fire (frozen core unreachable);
      // declared computed hooks already re-ran above, fenced to their targets.
      await this.hookRunner.run(doctype, "before_submitted_update", doc, ctx, session, user);

      // Workflow transition side-effects (transition path only). applyTransition
      // RETURNS the side_effects.set map; its keys must be band-legal too.
      if (pendingTransition && this.workflowEngine) {
        const sideEffects = await this.workflowEngine.applyTransition(
          entity,
          doc._data,
          pendingTransition.transition,
          pendingTransition.from,
          pendingTransition.to,
          user,
          session,
        );
        if (Object.keys(sideEffects).length > 0) {
          this.docStatusEngine.validateSubmittedPatch(
            entity,
            doc,
            { setFields: Object.keys(sideEffects), incrementFields: [], children: [] },
            { allowWorkflowField: true },
          );
          doc.merge(sideEffects);
        }
      }

      // Closing band guardrail: a before_submitted_update hook that dirtied a
      // NON-band field aborts the tx here (construction guarantee). The allowed
      // set is the BAND ITSELF — every allow_on_submit field — not just the
      // patch's touched fields: a hook may freely maintain any band field (e.g.
      // recompute a derived band counter), which is the documented contract.
      // Declared computed targets are band-adjacent (D5): the computed refresh
      // above is what rewrites them; they are read-only derived outputs, never
      // caller-settable (validateSubmittedPatch still rejects them in a patch).
      const allowed = new Set<string>(
        entity.fields.filter((f) => f.allow_on_submit === true).map((f) => f.fieldname),
      );
      for (const t of touchedTables) allowed.add(t);
      for (const f of computedTargets) allowed.add(f);
      if (options.allowWorkflowField) allowed.add(workflowField);
      if (pendingTransition) {
        for (const k of Object.keys(pendingTransition.transition?.side_effects?.set ?? {})) {
          allowed.add(k);
        }
      }
      for (const changed of doc.getChangedFields()) {
        if (!allowed.has(changed)) {
          throw new DocStatusError("field_not_allowed_on_submit", { doctype, field: changed });
        }
      }

      // Stamp + write. modified/modified_by are class props (never in _dirty);
      // getChanges() appends them.
      doc.modified = new Date();
      doc.modified_by = user.email;
      await this.db.updateOne(
        entity.name,
        name,
        { ...doc.getChanges(), modified: doc.modified, modified_by: doc.modified_by },
        entity.database,
        session,
      );

      await this.hookRunner.run(doctype, "on_submitted_update", doc, ctx, session, user);

      // Version — per-row granularity for touched tables (replace the
      // whole-array entry calculateChanges would emit with the childChanges).
      if (entity.track_changes) {
        const topLevel = calculateChanges(doc).filter((c) => !touchedTables.has(c.field));
        await this.versionService.createVersionFromChanges(
          doc.doctype,
          doc._id,
          [...topLevel, ...childChanges],
          user.email,
          session,
        );
      }

      // Activity log — post_submit + cause provenance + child summary.
      await this.activityLogService.log(
        {
          entity: doctype,
          document_name: name,
          action: "Updated",
          user: user.email,
          user_name: user.full_name ?? user.email,
          details: {
            changed_fields: doc.getChangedFields(),
            post_submit: true,
            ...(options.cause ? { cause: options.cause } : {}),
            ...(patch.children?.length
              ? {
                  children: patch.children.map((c) => ({
                    table: c.table,
                    row_id: c.row_id,
                    fields: [...Object.keys(c.set ?? {}), ...Object.keys(c.increment ?? {})],
                  })),
                }
              : {}),
          },
        },
        session,
      );
    };

    if (options.sessionOverride) {
      await runPostSubmitUpdate(options.sessionOverride);
    } else {
      await this.db.withTransaction(runPostSubmitUpdate);
    }

    ctx?.success("doc_saved", { doctype: entity.label ?? doctype, name });
    log.info(
      { doctype, name, user: user.email, post_submit: true, cause: options.cause },
      "Submitted document patched",
    );
    resultDoc._link_titles = await this.linkTitleResolver.resolve(entity, resultDoc._data);
    return resultDoc;
  }

  // ─── DELETE ────────────────────────────────────────────

  async deleteDoc(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
  ): Promise<void> {
    const entity = this.registry.get(doctype);
    const doc = await this.loadDocInternal(doctype, name);

    // Permission check
    await this.permissionChecker.check(user, doctype, "delete", doc._data);

    // Check if deletable
    this.docStatusEngine.validateDelete(entity, doc);

    // Delete protection — check for references
    const blockers = await this.deleteProtection.check(doctype, name);
    if (blockers.length > 0) {
      const totalRefs = blockers.reduce((sum, b) => sum + b.count, 0);
      ctx?.error("link_delete_blocked", {
        count: String(totalRefs),
        entity: blockers.map((b) => b.entity).join(", "),
      });
      throw new DeleteBlockedError(doctype, name, blockers);
    }

    // Transactional delete — before_delete + after_delete run within the
    // same session as the deletion so cascade cleanup can be atomic.
    await this.db.withTransaction(async (session) => {
      await this.hookRunner.run(doctype, "before_delete", doc, ctx, session, user);
      await this.db.deleteOne(entity.name, name, entity.database, session);
      // Cascade: remove this document's data-level translation rows so they don't
      // orphan — and don't resurrect stale overlays if a business-keyed _id is
      // reused later. Atomic with the delete (same session).
      await this.db.deleteMany(
        DIGITA.COLLECTIONS.TRANSLATION,
        { namespace: "data", entity: doctype, document_name: name },
        DIGITA.DATABASES.CORE,
        session,
      );
      await this.hookRunner.run(doctype, "after_delete", doc, ctx, session, user);

      await this.activityLogService.log(
        {
          entity: doctype,
          document_name: name,
          action: "Deleted",
          user: user.email,
          user_name: user.full_name ?? user.email,
        },
        session,
      );
    });

    // Cascade: reference-counted cleanup of the deleted doc's attachments
    // (post-commit, best-effort — never fails the delete).
    if (this.storage) {
      await cleanupDocumentAttachments(this.db, this.storage, entity.fields, doc._data);
    }

    ctx?.success("doc_deleted", {
      doctype: entity.label ?? doctype,
      name,
    });

    log.info({ doctype, name, user: user.email }, "Document deleted");
  }

  // ─── ACTION ────────────────────────────────────────────

  /**
   * Invoke a named entity action. Used by the
   * `POST /resource/:doctype/:name/action/:action_name` route.
   *
   * Steps: load doc (read perm enforced), look up action in entity meta,
   * verify the action's `requires_permission` and `show_if`, run handler
   * inside a transaction so any spawned doc rolls back on failure.
   *
   * Returns the handler's return value (typically `{ created: { entity, name } }`).
   * Throws when the action doesn't exist or the user can't run it.
   */
  async runAction(
    doctype: string,
    name: string,
    actionName: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    params?: Record<string, unknown>,
    extraServices?: Partial<HookServices>,
  ): Promise<unknown> {
    const entity = this.registry.get(doctype);
    const action = entity.actions?.find((a) => a.action === actionName);
    if (!action) {
      throw new NotFoundError(doctype, `action:${actionName}`);
    }
    // A2: a long_running (jobs) action with no registered handler used to return
    // silent success — scheduled runs then report "succeeded" forever while doing
    // nothing. Fail loud. Interactive actions may legitimately be handler-less
    // no-op confirmations, so ONLY long_running is gated.
    if (action.long_running && !this.hookRunner.hasActionHandler(doctype, actionName)) {
      throw new ActionHandlerMissingError(doctype, actionName);
    }

    // Check the standard read permission first — `getDoc` does this — then
    // the action-specific requires_permission if declared.
    const doc = await this.getDoc(doctype, name, user, ctx);
    if (action.requires_permission) {
      await this.permissionChecker.check(user, doctype, action.requires_permission, doc._data);
    }

    // Run inside a transaction so the handler's spawned docs (e.g. a
    // document created from another via an action) commit or roll back as
    // a single unit with any side effects. HookRunner.runAction merges
    // the session into its per-call services view, so the handler's
    // `services.documentService.insert(...)` joins this transaction
    // automatically (insert accepts a sessionOverride 6th arg).
    return this.db.withTransaction(async (session) => {
      const doc2 = await this.loadDocInternal(doctype, name);
      return this.hookRunner.runAction(doctype, actionName, doc2, ctx, session, user, params, extraServices);
    });
  }

  // ─── TRANSITION ────────────────────────────────────────

  /**
   * Apply a workflow state transition. Thin wrapper over `update()` that:
   *   Skips the standard `write` permission check (state-strip on the
   *     current state would otherwise deny it).
   *   Authorisation is delegated to `WorkflowEngine.validateTransition`,
   *     called by `update()` when it detects the workflow_field changing.
   *     That validator enforces `transitions[].allowed_roles` and the
   *     declared `condition` — both must hold for the transition to apply.
   *
   * Use case: a "Salesperson" with `state.permissions: [{ role: Salesperson,
   * write: 0 }]` on the current state can still trigger a transition to the
   * next state when `transitions[].allowed_roles` includes Salesperson.
   *
   * For a SUBMITTED doc (docstatus=1), a doc_status-1 → doc_status-1 state move
   * routes through `updateSubmitted()` (with the workflow field admitted into
   * the band) instead of `update()`, which hard-blocks submitted docs. This
   * makes declared post-submit transitions (e.g. salesOrder confirmed →
   * delivered) reachable for the first time, with `allowed_roles`, versioning
   * and the activity log intact. A move that would change docstatus (to a
   * doc_status 0 or 2 state) is rejected here — use `cancel()`/`amend()`.
   */
  async transition(
    doctype: string,
    name: string,
    toState: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);
    const workflowField = entity.workflow_field ?? "status";
    const doc = await this.loadDocInternal(doctype, name);

    if (entity.is_submittable && doc.docstatus === DocStatus.Submitted) {
      const toStateDef = (entity.states ?? []).find((s) => s.value === toState);
      const hasWorkflow = !!this.workflowEngine?.hasWorkflow(entity);
      if (hasWorkflow && toStateDef && toStateDef.doc_status === 1) {
        // A declared doc_status-1 → doc_status-1 move: the ONLY legal post-submit
        // transition. validateTransition (allowed_roles) runs inside.
        return this.updateSubmitted(
          doctype,
          name,
          { set: { [workflowField]: toState } },
          user,
          ctx,
          { skipWritePermCheck: true, allowWorkflowField: true },
        );
      }
      if (hasWorkflow && toStateDef && toStateDef.doc_status !== 1) {
        // Declared move that would change docstatus → use cancel()/amend().
        throw new DocStatusError("transition_requires_docstatus_verb", { doctype, to: toState });
      }
      // No workflow, or an UNDECLARED target state: fall through to update(),
      // which hard-blocks a submitted doc (cannot_edit_submitted). This closes
      // the E5 hole where a workflow-less submittable entity would have accepted
      // an arbitrary, permission-free status write via the transition route.
    }

    return this.update(doctype, name, { [workflowField]: toState }, user, ctx, {
      skipWritePermCheck: true,
    });
  }

  /**
   * Write-skew guard for the SUBMIT side (pairs with the touchGuard in runCancel).
   * For every submittable Link target of the doc being submitted: (1) touch the
   * target's shared `_doc_guards` entry so a concurrent `cancel(target)` collides on
   * the same document (→ MongoDB serializes them; one transaction retries with a
   * fresh snapshot), and (2) re-read the target under the session — if it has been
   * cancelled, refuse the submit rather than forward into a dead upstream. This is
   * the "cancel committed first" branch that the snapshot-isolation cancel-protection
   * re-check alone cannot catch. Only TOP-LEVEL Link fields are guarded; the current
   * apps declare no submittable→submittable child-table links (mirror of
   * CancelProtection's note).
   */
  private async guardSubmittableLinkTargets(
    entity: EntityDefinition,
    doc: BaseDocument,
    session: import("mongodb").ClientSession,
  ): Promise<void> {
    for (const field of entity.fields) {
      if (field.fieldtype !== "Link" || !field.target) continue;
      if (!this.registry.has(field.target)) continue;
      const targetEntity = this.registry.get(field.target);
      if (!targetEntity.is_submittable) continue;
      const val = doc.get(field.fieldname);
      if (typeof val !== "string" || !val) continue;

      await this.db.touchGuard(`${targetEntity.name}:${val}`, session);
      const targetDoc = await this.db.findOne(targetEntity.name, val, targetEntity.database, session);
      if (targetDoc && Number(targetDoc["docstatus"]) === 2) {
        throw new LinkTargetCancelledError(entity.name, field.fieldname, targetEntity.name, val);
      }
    }
  }

  // ─── SUBMIT ────────────────────────────────────────────

  async submit(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    /** When provided, the submit joins the caller's transaction instead of
     * opening its own. Used by hooks that auto-submit a spawned doc inside
     * the parent's submit (e.g. an on_submit posting + submitting a linked
     * ledger entry as part of the same atomic operation). */
    sessionOverride?: import("mongodb").ClientSession,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);
    // Read-side joins the override session so a just-inserted doc in
    // the parent transaction is visible to this submit.
    const doc = await this.loadDocInternal(doctype, name, sessionOverride);

    // Permission check
    await this.permissionChecker.check(user, doctype, "submit", doc._data);

    // Validate submit (sync state-machine check — must be Draft).
    this.docStatusEngine.validateSubmit(entity, doc);

    // ─── Transactional block ──────────────────────────────────────────
    // validate, before_submit, the status flip, the write, and on_submit
    // all run in a single MongoDB transaction. If any hook throws, the
    // entire submit rolls back atomically.
    //
    // `validate` and the period-close check run inside the transaction
    // so validate hooks read uncommitted in-tx state and any side-effect
    // writes they perform participate in the rollback chain.
    const runSubmit = async (session: import("mongodb").ClientSession) => {
      // H7 idempotency: submit() loaded the doc and ran validateSubmit OUTSIDE any
      // transaction, and the write below is an unconditional updateOne by _id — so
      // two concurrent submits (or a withTransaction retry after a write conflict)
      // would each re-run on_submit and double-post. Re-load + re-validate against
      // the committed state under the session; the loser aborts before any side
      // effects. (Skipped for sessionOverride — that path is a single atomic op on
      // a just-inserted draft.)
      if (!sessionOverride) {
        this.docStatusEngine.validateSubmit(
          entity,
          await this.loadDocInternal(doctype, name, session),
        );
      }

      // Write-skew guard: touch each submittable link target's guard (collides with a
      // concurrent cancel of that target) + refuse if the target is already cancelled.
      // Runs for the sessionOverride path too (an auto-submit still must not forward
      // into a cancelled upstream).
      await this.guardSubmittableLinkTargets(entity, doc, session);

      // Run validate hook (transactional — sees in-tx state, side-effect
      // writes roll back on failure).
      await this.hookRunner.run(doctype, "validate", doc, ctx, session, user);

      // Period-close enforcement (submit phase). Default block_on is ["submit"]
      // so this is the most common gate: drafts are tolerated in closed
      // periods, submission is not.
      if (this.periodCloseValidator) {
        await this.periodCloseValidator.assertPeriodOpen(entity, doc._data, "submit", session);
      }

      // Run before_submit hook (transactional)
      await this.hookRunner.run(doctype, "before_submit", doc, ctx, session, user);
      if (this.ruleEngine) {
        // Rules may set_value here (pre-write). Mark each mutated key dirty so
        // getChanges() below persists it — a bare _data write is dropped
        // otherwise (base-document.ts:130-138).
        const ruleMutations = await this.ruleEngine.execute(
          doctype,
          "before_submit",
          doc._data,
          user,
          session,
        );
        for (const f of Object.keys(ruleMutations ?? {})) doc._dirty.add(f);
      }

      // ── Snapshot at the docstatus 0→1 boundary ──
      // Resolves all `entity.snapshot[]` and per-Table `field.snapshot[]`
      // manifests, embedding declared fields from Link targets
      // into hand-declared read-only fields on the doc. Runs INSIDE the
      // submit transaction so any later failure rolls back the snapshot too.
      // We merge through `doc.merge(...)` so the change-tracker registers
      // every snapshot field as dirty — without this, `doc.getChanges()`
      // below would omit them and the write would not persist the freeze.
      // Once `applySubmit` flips docstatus, the existing freeze locks the
      // snapshot along with the rest of the doc.
      if (
        this.snapshotResolver &&
        (entityHasAnySnapshot(entity) || entityHasAnyFreeze(entity))
      ) {
        const snapshotted = await this.snapshotResolver.resolve(entity, doc._data, session);
        doc.merge(snapshotted);
      }

      // Re-run computed hooks so derived fields (totals, FX conversions,
      // anything that reads other fields) reflect snapshot mutations and
      // any drift since the last save. The submit path otherwise skips
      // computed entirely — derived values would be whatever was on the
      // doc at last UPDATE, which can be stale by the time of submit.
      await this.hookRunner.runComputedHooks(doctype, doc, ctx, session, user);

      // Apply status change
      this.docStatusEngine.applySubmit(doc);

      // Sync the workflow `status` field to a state with doc_status=1 if
      // the entity declares one. Without this, a submitted doc sits at
      // status="draft" forever — confusing for users and downstream
      // reports that filter by status. Skipped when no matching state
      // exists or no workflow declared. Bypasses transition validation
      // because this is a system-driven flip (the user already passed
      // permission_check("submit")), not a user-chosen state change.
      if (this.workflowEngine && this.workflowEngine.hasWorkflow(entity)) {
        const wfField = this.workflowEngine.getWorkflowField(entity);
        const targetState = this.workflowEngine.getStateForDocStatus(entity, 1);
        if (targetState && doc.get(wfField) !== targetState) {
          doc.set(wfField, targetState);
        }
      }

      doc.modified = new Date();
      doc.modified_by = user.email;

      await this.db.updateOne(
        entity.name,
        name,
        {
          docstatus: doc.docstatus,
          ...doc.getChanges(),
          modified: doc.modified,
          modified_by: doc.modified_by,
        },
        entity.database,
        session,
      );

      // Run on_submit hook — typically writes any derived/side-effect
      // documents that should commit atomically with the submit itself.
      await this.hookRunner.run(doctype, "on_submit", doc, ctx, session, user);
      if (this.ruleEngine) {
        await this.ruleEngine.execute(doctype, "on_submit", doc._data, user, session);
      }
      await this.hookRunner.run(doctype, "on_change", doc, ctx, session, user);

      if (entity.track_changes) {
        await this.versionService.createVersion(doc, user.email, session);
      }
      await this.activityLogService.log(
        {
          entity: doctype,
          document_name: name,
          action: "Submitted",
          user: user.email,
          user_name: user.full_name ?? user.email,
        },
        session,
      );
    };
    if (sessionOverride) {
      await runSubmit(sessionOverride);
    } else {
      await this.db.withTransaction(runSubmit);
    }

    ctx?.success("doc_submitted", {
      doctype: entity.label ?? doctype,
      name,
    });

    log.info({ doctype, name, user: user.email }, "Document submitted");

    return doc;
  }

  // ─── CANCEL ────────────────────────────────────────────

  async cancel(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
    /** When provided, the cancel joins the caller's transaction. Used by
     * cascade hooks that cancel a child doc as part of a parent cancel. */
    sessionOverride?: import("mongodb").ClientSession,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);
    const doc = await this.loadDocInternal(doctype, name, sessionOverride);

    // Permission check
    await this.permissionChecker.check(user, doctype, "cancel", doc._data);

    // Validate cancel
    this.docStatusEngine.validateCancel(entity, doc);

    // Forward immutability — block cancel when this doc has been forwarded
    // into a submitted downstream doc. The downstream must be cancelled
    // first before the upstream can be cancelled.
    const cancelBlockers = await this.cancelProtection.check(doctype, name);
    if (cancelBlockers.length > 0) {
      const totalRefs = cancelBlockers.reduce((sum, b) => sum + b.count, 0);
      ctx?.error("cancel_blocked_forwarded", {
        count: String(totalRefs),
        entity: cancelBlockers.map((b) => b.entity).join(", "),
      });
      throw new CancelBlockedError(doctype, name, cancelBlockers);
    }

    // Transactional cancel — before_cancel + status flip + write + on_cancel +
    // on_change all run in one MongoDB session, mirroring submit/insert/update.
    // Side-effects spawned in on_cancel (e.g. reversing journal entries,
    // releasing stock reservations) roll back together if anything throws.
    const runCancel = async (session: import("mongodb").ClientSession) => {
      // H7 idempotency (see submit): re-load + re-validate under the session so a
      // concurrent cancel or a withTransaction retry can't re-run on_cancel and
      // double-reverse. Skipped for sessionOverride (single atomic cascade op).
      if (!sessionOverride) {
        this.docStatusEngine.validateCancel(
          entity,
          await this.loadDocInternal(doctype, name, session),
        );
      }

      // Write-skew guard: touch this doc's own guard so a concurrent submit that
      // links to it (which touches the SAME guard for its link target) collides here
      // → one transaction retries with a fresh snapshot, and the in-tx cancel-
      // protection re-check below then sees the freshly-submitted downstream. This is
      // what turns the former window-narrowing re-check into a full race close.
      await this.db.touchGuard(`${entity.name}:${name}`, session);

      // Re-run the forward-immutability check under the transaction session. Combined
      // with the guard write above this is now a FULL race close: a downstream submit
      // that committed after the pre-transaction check touched the same guard, so this
      // transaction retried with a fresh snapshot and the re-check below sees the
      // submitted downstream (previously snapshot isolation left a write-skew window).
      // Skipped for sessionOverride (single atomic cascade op).
      if (!sessionOverride) {
        const inTxBlockers = await this.cancelProtection.check(doctype, name, session);
        if (inTxBlockers.length > 0) {
          const totalRefs = inTxBlockers.reduce((sum, b) => sum + b.count, 0);
          ctx?.error("cancel_blocked_forwarded", {
            count: String(totalRefs),
            entity: inTxBlockers.map((b) => b.entity).join(", "),
          });
          throw new CancelBlockedError(doctype, name, inTxBlockers);
        }
      }

      // enforce period_check.block_on for "cancel" phase so
      // submitted docs in closed accounting periods can't be silently
      // rolled back. Defaults exclude cancel; entities that need to seal
      // their cancel window opt in via block_on: ["submit", "cancel"].
      if (this.periodCloseValidator) {
        await this.periodCloseValidator.assertPeriodOpen(entity, doc._data, "cancel", session);
      }

      // `sessionOverride` is set only when a parent doc's cancel cascades into this
      // one (see the param doc above), so it doubles as the cascade signal: surface
      // it to before_cancel so a source-owned child can refuse a DIRECT cancel.
      await this.hookRunner.run(doctype, "before_cancel", doc, ctx, session, user, {
        cancelCascade: !!sessionOverride,
      });
      if (this.ruleEngine) {
        // before_cancel rules fire before the docstatus 1→2 flip. set_value is
        // rejected here (pre-cancel, not a pre-write mutation point).
        await this.ruleEngine.execute(doctype, "before_cancel", doc._data, user, session);
      }

      this.docStatusEngine.applyCancel(doc);

      // Mirror the submit-side workflow sync — flip the workflow status
      // field to a doc_status=2 state (typically "cancelled") if the
      // entity declares one. System-driven flip; bypasses transition
      // validation.
      if (this.workflowEngine && this.workflowEngine.hasWorkflow(entity)) {
        const wfField = this.workflowEngine.getWorkflowField(entity);
        const targetState = this.workflowEngine.getStateForDocStatus(entity, 2);
        if (targetState && doc.get(wfField) !== targetState) {
          doc.set(wfField, targetState);
        }
      }

      doc.modified = new Date();
      doc.modified_by = user.email;

      await this.db.updateOne(
        entity.name,
        name,
        {
          docstatus: doc.docstatus,
          ...doc.getChanges(),
          modified: doc.modified,
          modified_by: doc.modified_by,
        },
        entity.database,
        session,
      );

      await this.hookRunner.run(doctype, "on_cancel", doc, ctx, session, user);
      await this.hookRunner.run(doctype, "on_change", doc, ctx, session, user);

      if (entity.track_changes) {
        await this.versionService.createVersion(doc, user.email, session);
      }
      await this.activityLogService.log(
        {
          entity: doctype,
          document_name: name,
          action: "Cancelled",
          user: user.email,
          user_name: user.full_name ?? user.email,
        },
        session,
      );
    };
    if (sessionOverride) {
      await runCancel(sessionOverride);
    } else {
      await this.db.withTransaction(runCancel);
    }

    ctx?.success("doc_cancelled", {
      doctype: entity.label ?? doctype,
      name,
    });

    log.info({ doctype, name, user: user.email }, "Document cancelled");

    return doc;
  }

  // ─── AMEND ─────────────────────────────────────────────

  async amend(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);
    const doc = await this.loadDocInternal(doctype, name);

    // Permission check
    await this.permissionChecker.check(user, doctype, "amend", doc._data);

    const amendData = this.docStatusEngine.prepareAmend(entity, doc);
    const copyData = copyDocumentData(entity, doc._data);
    // Give the amendment its OWN File docs (sharing the same blob) so deleting or
    // replacing an attachment on either document never destroys the other's.
    await this.cloneAttachments(entity, copyData, user);

    const newDoc = await this.insert(doctype, { ...copyData, ...amendData }, user, ctx);

    // The "Amended" entry is supplemental to the "Created" entry that
    // insert() already wrote transactionally; if this one fails we keep
    // the new doc rather than rolling it back, so a session-less
    // best-effort write is the right shape here.
    await this.activityLogService.log({
      entity: doctype,
      document_name: newDoc._id,
      action: "Amended",
      user: user.email,
      user_name: user.full_name ?? user.email,
      details: { amended_from: name },
    });

    return newDoc;
  }

  // ─── COPY ──────────────────────────────────────────────

  async copyDoc(
    doctype: string,
    name: string,
    user: UserContext = GUEST_USER,
    ctx?: ResponseContext,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);

    // Two checks: `create` to land the new doc + `read` on the source.
    // Without the read check, copyDoc was a read-bypass — a user with
    // create-only could observe any source doc's content via the copy.
    await this.permissionChecker.check(user, doctype, "create");
    await this.permissionChecker.check(user, doctype, "read");

    const doc = await this.loadDocInternal(doctype, name);
    // Document-level read check (owner / condition / scope filters).
    await this.permissionChecker.check(user, doctype, "read", doc._data);

    const copyData = copyDocumentData(entity, doc._data);
    // Give the copy its OWN File docs (sharing the same blob) so attachment
    // deletes/replaces on either document don't destroy the other's file.
    await this.cloneAttachments(entity, copyData, user);
    return this.insert(doctype, copyData, user, ctx);
  }

  /**
   * Clone the File docs referenced by a copy/amend's attach fields. Copy/amend
   * carry the SOURCE document's attach URLs verbatim, so both documents pointed
   * at ONE File doc — deleting or replacing the attachment on either silently
   * destroyed the other's (refcount is by storage_key, so the blob itself is
   * safe; the File doc pointer is not). For each attach-type field (top-level +
   * Table child_fields) this mints a NEW File doc that shares the same
   * storage_key/thumbnail_key/blob but has its own _id + URL, and rewrites the
   * field to the new URL. A missing/legacy File doc is left untouched (skipped).
   */
  private async cloneAttachments(
    entity: EntityDefinition,
    data: Record<string, unknown>,
    user: UserContext,
  ): Promise<void> {
    const cloneOne = async (value: unknown): Promise<string | undefined> => {
      const srcId = parseFileId(value);
      if (!srcId) return undefined;
      const src = await this.db.findOne(DIGITA.COLLECTIONS.FILE, srcId, DIGITA.DATABASES.CORE);
      if (!src) return undefined; // legacy/missing File doc → leave the ref as-is
      const s = src as Record<string, unknown>;
      const seq = await this.db.getNextSequence(
        DIGITA.COLLECTIONS.FILE,
        "naming_seq",
        DIGITA.DATABASES.CORE,
      );
      const newId = `FILE-${String(seq).padStart(6, "0")}`;
      const isPublic = s["is_private"] === false;
      const fileUrl = isPublic
        ? `${env.API_PREFIX}/public/file/${newId}`
        : `${env.API_PREFIX}/file/${newId}/download`;
      const now = new Date();
      const clone: Record<string, unknown> = {
        ...s,
        _id: newId,
        file_url: fileUrl,
        owner: user.email,
        modified_by: user.email,
        creation: now,
        modified: now,
      };
      // The clone is not yet linked to the new document — drop the source's
      // specific attach target (a save hook re-links if the app wires one).
      delete clone["attached_to_name"];
      if (s["thumbnail_key"]) clone["thumbnail_url"] = `${fileUrl}?thumb=1`;
      await this.db.insertOne(DIGITA.COLLECTIONS.FILE, clone, DIGITA.DATABASES.CORE);
      return fileUrl;
    };

    for (const field of entity.fields) {
      if (FILE_FIELD_TYPES.has(field.fieldtype)) {
        const newUrl = await cloneOne(data[field.fieldname]);
        if (newUrl) data[field.fieldname] = newUrl;
      } else if (
        field.fieldtype === "Table" &&
        field.child_fields &&
        Array.isArray(data[field.fieldname])
      ) {
        const attachChildFields = field.child_fields.filter((cf) =>
          FILE_FIELD_TYPES.has(cf.fieldtype),
        );
        if (attachChildFields.length === 0) continue;
        for (const row of data[field.fieldname] as Record<string, unknown>[]) {
          if (!row || typeof row !== "object") continue;
          for (const cf of attachChildFields) {
            const newUrl = await cloneOne(row[cf.fieldname]);
            if (newUrl) row[cf.fieldname] = newUrl;
          }
        }
      }
    }
  }

  // ─── INTERNAL HELPERS ──────────────────────────────────

  /**
   * Load a document without permission checks (for internal use).
   */
  private async loadDocInternal(
    doctype: string,
    name: string,
    session?: import("mongodb").ClientSession,
  ): Promise<BaseDocument> {
    const entity = this.registry.get(doctype);
    const raw = await this.db.findOne(entity.name, name, entity.database, session);
    if (!raw) throw new NotFoundError(doctype, name);
    const doc = new BaseDocument(doctype, raw as Record<string, unknown>);
    this.deserializeFields(entity, doc);
    return doc;
  }

  private serializeFields(
    entity: EntityDefinition,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const field of entity.fields) {
      if (!isStoredFieldType(field.fieldtype)) continue;

      const value = data[field.fieldname];
      if (value === undefined) continue;

      const handler = getFieldTypeHandler(field.fieldtype);
      try {
        result[field.fieldname] = handler.toStorage(value, field);
      } catch (err) {
        if (err instanceof FieldValueError) {
          throw new ValidationFailedError(entity.name, [
            { field: err.field, message_key: err.message_key, params: err.params },
          ]);
        }
        throw err;
      }
    }

    // Pass through unknown fields
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith("_") || result[key] !== undefined) continue;
      const knownField = entity.fields.find((f) => f.fieldname === key);
      if (!knownField) {
        result[key] = value;
      }
    }

    return result;
  }

  private deserializeFields(entity: EntityDefinition, doc: BaseDocument): void {
    for (const field of entity.fields) {
      if (!isStoredFieldType(field.fieldtype)) continue;

      const value = doc.get(field.fieldname);
      if (value === undefined || value === null) continue;

      const handler = getFieldTypeHandler(field.fieldtype);
      const deserialized = handler.fromStorage(value, field);

      if (deserialized !== value) {
        doc._data[field.fieldname] = deserialized;
      }
    }
  }
}
