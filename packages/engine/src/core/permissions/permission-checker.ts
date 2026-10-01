import type { EntityDefinition, EntityPermission, FieldDefinition, StatePermissionOverride } from "@digitaplatform/shared";
import { EngineError } from "../errors/engine-error.js";
import { ROW_ID_FIELD, SYSTEM_ROLES, canGrantActionTo } from "@digitaplatform/shared";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { docFieldsOf, evaluateExpression } from "../expression/expression-evaluator.js";
import { permissionRowsFor, scopeValueMatches } from "./scope-filter.js";
import type { UserContext, PermissionCheckResult } from "./types.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("permission-checker");

/** The code of each action of a permission row: the person reads what they may not do. */
const ACTION_CODES: Record<string, string> = {
  select: "permission_denied_select",
  read: "permission_denied_read",
  write: "permission_denied_write",
  create: "permission_denied_create",
  delete: "permission_denied_delete",
  submit: "permission_denied_submit",
  cancel: "permission_denied_cancel",
  amend: "permission_denied_amend",
  print: "permission_denied_print",
  email: "permission_denied_email",
  export: "permission_denied_export",
  import: "permission_denied_import",
  share: "permission_denied_share",
  report: "permission_denied_report",
};

export class PermissionDeniedError extends EngineError {
  constructor(code: string, params: Record<string, string>) {
    super(code, params, 403, "PERMISSION_DENIED");
  }

  /** A refused action on `doctype`; an action no permission row names (an action's own
   *  `requires_permission`) reads as a refused action on `doctype`. */
  static forAction(doctype: string, action: string): PermissionDeniedError {
    return new PermissionDeniedError(ACTION_CODES[action] ?? "permission_denied_doc", { doctype });
  }
}

/**
 * Late-bound interface so PermissionChecker can consult the WorkflowEngine
 * without a circular import (WorkflowEngine → RuleEngine → DocumentService →
 * PermissionChecker → WorkflowEngine).
 */
export interface StateOverrideResolver {
  resolveStateOverride(
    entity: EntityDefinition,
    doc: Record<string, unknown> | undefined,
    role: string,
  ): StatePermissionOverride | null;
}

export class PermissionChecker {
  private workflowEngine?: StateOverrideResolver;
  // One-time warning per entity when a state-strip override is declared
  // but the workflow engine has not been wired in. Stops the silent skip
  // from being a permanent blind spot — the operator sees it on first use.
  private warnedMissingEngine = new Set<string>();

  constructor(private registry: EntityRegistry) {}

  /** Wire the workflow engine after construction. The platform always
   *  injects it from app.ts; tests or experimental harnesses may omit it. */
  setWorkflowEngine(we: StateOverrideResolver): void {
    this.workflowEngine = we;
  }

  /**
   * Check if a user has a specific permission on an entity.
   * Throws PermissionDeniedError if not allowed.
   */
  async check(
    user: UserContext,
    entityName: string,
    action: string,
    doc?: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.hasPermission(user, entityName, action, doc);
    if (!result.allowed) {
      log.warn(
        {
          user: user.email,
          entity: entityName,
          action,
          reason: result.reason,
        },
        "Permission denied",
      );
      throw PermissionDeniedError.forAction(entityName, action);
    }
  }

  /**
   * Check permission without throwing.
   */
  async hasPermission(
    user: UserContext,
    entityName: string,
    action: string,
    doc?: Record<string, unknown>,
  ): Promise<PermissionCheckResult> {
    // Administrator bypasses everything
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) {
      return { allowed: true };
    }

    const entity = this.registry.get(entityName);
    const permissions = permissionRowsFor(entity, user);

    if (!permissions || permissions.length === 0) {
      return { allowed: false, reason: "No permissions defined" };
    }

    // Find matching permissions for user's roles at level 0
    const matchingPerms = permissions.filter((p) => canGrantActionTo(p, user.roles));

    if (matchingPerms.length === 0) {
      return { allowed: false, reason: "No matching role" };
    }

    // Check if any matching permission grants the action
    for (const perm of matchingPerms) {
      if (!this.permissionGrantsAction(perm, action)) continue;

      // State-strip override: when the doc's current workflow state declares
      // a per-role permission strip (e.g. `state.permissions: [{ role: "X",
      // write: 0 }]`), skip this role for this action. STRIP-only — cannot
      // grant beyond base permission. AND with base perms.
      if (this.workflowEngine && doc) {
        const override = this.workflowEngine.resolveStateOverride(entity, doc, perm.role);
        if (override && this.stateOverrideStrips(override, action)) {
          continue; // this role doesn't grant in this state
        }
      } else if (!this.workflowEngine && doc && entityHasStateStripOverrides(entity)) {
        // Entity declares state-strip permissions but the workflow engine
        // is not wired — strip enforcement is currently bypassed. Warn
        // once per entity so the operator notices.
        if (!this.warnedMissingEngine.has(entity.name)) {
          this.warnedMissingEngine.add(entity.name);
          log.warn(
            { entity: entity.name, role: perm.role, action },
            "workflowEngine not injected — state-strip permission overrides are NOT enforced. " +
              "Inject WorkflowEngine via setWorkflowEngine() to honor declared state.permissions.",
          );
        }
      }

      // Check if_owner
      if (perm.if_owner && doc) {
        if (doc["owner"] !== user.email && doc["owner"] !== user._id) {
          continue; // Not the owner, try next permission
        }
      }

      // Check condition. Fail CLOSED (safeDefault=false): a malformed access
      // condition must DENY, never silently grant (e.g. a typo'd public-read
      // `eval:doc.status=='published'` must not expose drafts).
      if (perm.condition && doc) {
        const conditionMet = evaluateExpression(
          perm.condition,
          { doc, user: user as Record<string, unknown> },
          false,
        );
        if (!conditionMet) continue;
      }

      // Check scope (single-doc), as applyScopeFilters does for a list.
      if (perm.scope && doc) {
        const docValue = doc[perm.scope.field];
        const userValue = (user as Record<string, unknown>)[perm.scope.user_field];
        if (!scopeValueMatches(docValue, userValue)) continue;
      }

      return { allowed: true };
    }

    return { allowed: false, reason: `No permission grants "${action}"` };
  }

  /**
   * Does this permission's ROW-level gate (if_owner / condition / scope) admit
   * `doc`? Mirrors the checks in hasPermission. With no doc (a field-SET query,
   * not per-doc masking) a conditional permission is treated as a potential grant
   * — the caller isn't masking a specific document. When a doc IS supplied, a
   * conditional permission's perm_level only counts if its gate passes for that
   * doc, so e.g. an if_owner level-1 grant does not expose level-1 fields on a
   * document the user does not own (H-P1).
   */
  private permMatchesDoc(
    perm: EntityDefinition["permissions"][number],
    user: UserContext,
    doc?: Record<string, unknown>,
  ): boolean {
    if (!doc) return true;
    if (perm.if_owner && doc["owner"] !== user.email && doc["owner"] !== user._id) return false;
    if (perm.condition) {
      const met = evaluateExpression(
        perm.condition,
        { doc, user: user as Record<string, unknown> },
        false,
      );
      if (!met) return false;
    }
    if (perm.scope) {
      if (
        !scopeValueMatches(
          doc[perm.scope.field],
          (user as Record<string, unknown>)[perm.scope.user_field],
        )
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Does the user hold a level-0 read permission on this entity that carries a
   * `condition`, so whether a row may be read at all depends on its stored values?
   * scope/if_owner are translated into the Mongo filter by applyScopeFilters, but a
   * `condition` is an arbitrary expression that cannot be — so enumeration paths
   * (list/count/exists) must re-check it per row, and a view aggregate, which
   * cannot re-check a reshaped row, refuses the entity. Returns false (no
   * per-row cost) for Administrators and entities without such a grant.
   */
  hasConditionalRowRead(user: UserContext, entityName: string): boolean {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return false;
    const entity = this.registry.get(entityName);
    return permissionRowsFor(entity, user).some(
      (p) => p.level === 0 && !!p.read && !!p.condition && user.roles.includes(p.role),
    );
  }

  /**
   * Does any read grant the user holds on this entity, at any level, depend on the
   * stored row: an owner, a condition or a scope? Which fields of a row
   * the user may read is then decided on the whole stored row, since a projection
   * may lack the fields such a grant reads; a list or a search projects afterwards.
   */
  hasRowDependentRead(user: UserContext, entityName: string): boolean {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return false;
    const entity = this.registry.get(entityName);
    return permissionRowsFor(entity, user).some(
      (p) =>
        !!p.read &&
        user.roles.includes(p.role) &&
        (!!p.if_owner || !!p.condition || !!p.scope),
    );
  }

  /**
   * May a row of this entity be hidden from a user who may list it? A grant the user
   * holds may depend on an owner, a condition or a scope, a workflow state may take
   * read away from one of the user's roles, or the rows may name the roles that see them.
   */
  mayHideRows(user: UserContext, entityName: string): boolean {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return false;
    const entity = this.registry.get(entityName);
    if (entity.role_visibility_field) return true;
    const gatedGrant = entity.permissions.some(
      (p) =>
        (!!p.select || !!p.read) &&
        user.roles.includes(p.role) &&
        (!!p.if_owner || !!p.condition || !!p.scope),
    );
    const strippedRead = (entity.states ?? []).some((state) =>
      (state.permissions ?? []).some((o) => o.read === 0 && user.roles.includes(o.role)),
    );
    return gatedGrant || strippedRead;
  }

  /** Map the action string to the StatePermissionOverride key and return
   *  true when the override sets that key to 0 (strip). Unknown actions
   *  (those not in StatePermissionOverride) cannot be stripped — fall through. */
  private stateOverrideStrips(override: StatePermissionOverride, action: string): boolean {
    switch (action) {
      case "read":
        return override.read === 0;
      case "write":
        return override.write === 0;
      case "submit":
        return override.submit === 0;
      case "cancel":
        return override.cancel === 0;
      case "delete":
        return override.delete === 0;
      default:
        return false;
    }
  }

  /**
   * Get all fields the user can read: by perm_level, and by `fields` on a row that names them.
   */
  getReadableFields(
    user: UserContext,
    entityName: string,
    doc?: Record<string, unknown>,
    sharedForRead = false,
  ): Set<string> | null {
    // A conditional (if_owner/condition/scope) grant only contributes its level
    // when it admits `doc`. A document shared with the user for reading shows what
    // a level-0 read shows; higher levels stay with the user's roles.
    return this.getReadableFieldsWhere(
      user,
      entityName,
      (perm) => this.permMatchesDoc(perm, user, doc),
      sharedForRead,
    );
  }

  /**
   * Fields the user reads on every row of the entity, for a read over many rows
   * such as a view aggregate. A grant gated by if_owner, condition or scope does
   * not count: nothing checks the gate per row, and an empty document can pass a
   * condition such as `doc.status != "Closed"`.
   */
  getReadableFieldsOnEveryRow(user: UserContext, entityName: string): Set<string> | null {
    return this.getReadableFieldsWhere(
      user,
      entityName,
      (perm) => !perm.if_owner && !perm.condition && !perm.scope,
    );
  }

  private getReadableFieldsWhere(
    user: UserContext,
    entityName: string,
    admits: (perm: EntityDefinition["permissions"][number]) => boolean,
    readsLevel0 = false,
  ): Set<string> | null {
    // Administrator can read everything
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) {
      return null; // null means all fields
    }

    const entity = this.registry.get(entityName);
    const rows: ReadRow[] = permissionRowsFor(entity, user).filter(
      (perm) => user.roles.includes(perm.role) && !!perm.read && admits(perm),
    );
    if (readsLevel0) rows.push({ level: 0 });

    const readableFields = new Set<string>(IDENTITY_FIELDS);
    for (const field of entity.fields) {
      if (rows.some((row) => opensField(row, field.fieldname, field.perm_level ?? 0))) {
        readableFields.add(field.fieldname);
      }
    }
    if (opensOperatorFields(rows)) for (const field of OPERATOR_FIELDS) readableFields.add(field);
    return readableFields;
  }

  /**
   * Per-Table child-field readable set. Returns `null` (all child fields
   * readable) when the user is Administrator or no child field declares
   * `perm_level > 0`. Otherwise returns the allowed child fieldnames, plus
   * `_row_id` and `idx` always.
   */
  getReadableChildFields(
    user: UserContext,
    entityName: string,
    tableFieldname: string,
    doc?: Record<string, unknown>,
    sharedForRead = false,
  ): Set<string> | null {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return null;
    const entity = this.registry.get(entityName);
    const tableField = entity.fields.find((f) => f.fieldname === tableFieldname);
    if (!tableField || !tableField.child_fields?.length) return null;
    const anyGated = tableField.child_fields.some((c) => (c.perm_level ?? 0) > 0);
    if (!anyGated) return null;

    const rows: ReadRow[] = permissionRowsFor(entity, user).filter(
      (perm) => user.roles.includes(perm.role) && !!perm.read && this.permMatchesDoc(perm, user, doc),
    );
    if (sharedForRead) rows.push({ level: 0 });
    const out = new Set<string>(["_row_id", "idx"]);
    for (const child of tableField.child_fields) {
      if (rows.some((row) => opensField(row, tableFieldname, child.perm_level ?? 0))) out.add(child.fieldname);
    }
    return out;
  }

  /**
   * The fields a list may be filtered, searched or sorted on for `user`: those it
   * may read on every row the list can answer, so whether a row answers, or where
   * it sorts, reveals no masked value. `null`: every field (Administrator). A read
   * row that holds on every row opens its fields there. Otherwise every level-0
   * read row must open the field, whatever its scope, owner or condition: the list
   * keeps only the rows one of them admits, and a row another one admits must show
   * the field too. A Table whose children are all readable is named whole;
   * otherwise only its readable children are, as `table.child`.
   */
  getFilterableFields(user: UserContext, entityName: string): Set<string> | null {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return null;
    const entity = this.registry.get(entityName);
    const reads = permissionRowsFor(entity, user).filter((perm) => !!perm.read && user.roles.includes(perm.role));
    const fields = new Set<string>();
    for (const field of entity.fields) {
      if (!opensOnEveryListedRow(reads, (row) => opensField(row, field.fieldname, field.perm_level ?? 0))) continue;
      const children = field.fieldtype === "Table" ? (field.child_fields ?? []) : [];
      const readableChildren = children.filter((child) =>
        opensOnEveryListedRow(reads, (row) => opensField(row, field.fieldname, child.perm_level ?? 0)),
      );
      if (readableChildren.length === children.length) fields.add(field.fieldname);
      else for (const child of readableChildren) fields.add(`${field.fieldname}.${child.fieldname}`);
    }
    return fields;
  }

  /**
   * Whether `user` may see `displayField` of the stored `row` of `entityName`, the
   * title a Link to that row shows: the user may select or read the row, and a row
   * of the user that admits it opens the field. A picker shows a level-0 title to
   * whoever may select, so a link title does too, unless the rows that select or
   * read this row name `fields` without it; a title above level 0 needs a read of
   * its level.
   */
  async isTitleVisible(
    user: UserContext,
    entityName: string,
    row: Record<string, unknown>,
    displayField: string,
  ): Promise<boolean> {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return true;
    const admitted =
      (await this.hasPermission(user, entityName, "select", row)).allowed ||
      (await this.hasPermission(user, entityName, "read", row)).allowed;
    if (!admitted) return false;
    const entity = this.registry.get(entityName);
    const level = entity.fields.find((f) => f.fieldname === displayField)?.perm_level ?? 0;
    const admittingRowOpensTitle = permissionRowsFor(entity, user).some(
      (perm) =>
        user.roles.includes(perm.role) &&
        (!!perm.select || !!perm.read) &&
        opensField(perm, displayField, 0) &&
        this.permMatchesDoc(perm, user, row),
    );
    if (level === 0 && admittingRowOpensTitle) return true;
    const readable = this.getReadableFields(user, entityName, row);
    return readable === null || readable.has(displayField);
  }

  /**
   * Whether a link picker or a search of `user` on `entityName` shows `displayField` on every
   * row it answers, and so may match and sort on it: whoever may select or read sees the title
   * where a row of theirs that holds on every row opens it, or else every level-0 row through
   * which a record answers does.
   */
  isPickerTitleVisible(user: UserContext, entityName: string, displayField: string): boolean {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return true;
    const rows = permissionRowsFor(this.registry.get(entityName), user).filter(
      (perm) => user.roles.includes(perm.role) && (!!perm.select || !!perm.read),
    );
    return opensOnEveryListedRow(rows, (row) => opensField(row, displayField, 0));
  }

  /**
   * The stored fields a row read check of `user` on `entityName` reads
   * (hasPermission "read" with a row): the owner, a scope field, the fields a
   * condition names, and the workflow state a state strip reads. `undefined` when
   * a condition's fields cannot be named, so the caller loads whole rows.
   */
  listReadGateFields(user: UserContext, entityName: string): string[] | undefined {
    const entity = this.registry.get(entityName);
    const fields = new Set<string>(["_id", "docstatus", entity.workflow_field ?? "status"]);
    for (const perm of permissionRowsFor(entity, user)) {
      if (perm.level !== 0 || !perm.read || !user.roles.includes(perm.role)) continue;
      if (perm.if_owner) fields.add("owner");
      if (perm.scope) fields.add(perm.scope.field);
      if (perm.condition) {
        const named = docFieldsOf(perm.condition);
        if (!named) return undefined;
        for (const field of named) fields.add(field);
      }
    }
    return [...fields];
  }

  /** The set of field names a list, count or search query of `user` may filter,
   *  search and sort `entityName` on: the entity's declared fields + Table child
   *  fields for a reader of every level, otherwise getFilterableFields; + the
   *  identity fields, and `owner` and `modified_by` where every row the list answers
   *  shows them: always where no read row names `fields` (P-SEC/R7). */
  getFilterAllowlist(user: UserContext, entityName: string): Set<string> {
    const entity = this.registry.get(entityName);
    const filterable = this.getFilterableFields(user, entityName);
    const reads = permissionRowsFor(entity, user).filter((perm) => !!perm.read && user.roles.includes(perm.role));
    const showsOperatorFields = !reads.some((row) => row.fields) || opensOnEveryListedRow(reads, (row) => !row.fields);
    const operatorFields = filterable === null || showsOperatorFields ? OPERATOR_FIELDS : [];
    return new Set<string>([
      ...(filterable ?? [
        ...entity.fields.map((f) => f.fieldname),
        ...entity.fields
          .filter((f) => f.fieldtype === "Table")
          .flatMap((f) => f.child_fields?.map((c) => c.fieldname) ?? []),
      ]),
      ...IDENTITY_FIELDS,
      ...operatorFields,
      "idx", "parent", "parenttype", "parentfield",
    ]);
  }

  /**
   * Get all fields the user can write (based on perm_level).
   */
  getWritableFields(
    user: UserContext,
    entityName: string,
    doc?: Record<string, unknown>,
  ): Set<string> | null {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) {
      return null; // null means all fields
    }

    const entity = this.registry.get(entityName);
    const writableFields = new Set<string>();

    const writableLevels = new Set<number>();

    for (const perm of permissionRowsFor(entity, user)) {
      if (!user.roles.includes(perm.role)) continue;
      if (perm.write && this.permMatchesDoc(perm, user, doc)) {
        writableLevels.add(perm.level);
      }
    }

    for (const field of entity.fields) {
      const level = field.perm_level ?? 0;
      if (writableLevels.has(level) && !field.read_only) {
        writableFields.add(field.fieldname);
      }
    }

    return writableFields;
  }

  /**
   * Per-Table child-field writable set. Returns `null` (all child fields
   * writable) when the user is Administrator or no child field is gated
   * (`perm_level > 0` or `read_only`). Otherwise the allowed child fieldnames,
   * plus `_row_id` and `idx` always.
   */
  getWritableChildFields(
    user: UserContext,
    entityName: string,
    tableFieldname: string,
    doc?: Record<string, unknown>,
  ): Set<string> | null {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return null;
    const entity = this.registry.get(entityName);
    const tableField = entity.fields.find((f) => f.fieldname === tableFieldname);
    if (!tableField || !tableField.child_fields?.length) return null;
    const anyGated = tableField.child_fields.some((c) => (c.perm_level ?? 0) > 0 || c.read_only);
    if (!anyGated) return null;

    const writableLevels = new Set<number>();
    for (const perm of permissionRowsFor(entity, user)) {
      if (!user.roles.includes(perm.role)) continue;
      if (perm.write && this.permMatchesDoc(perm, user, doc)) writableLevels.add(perm.level);
    }
    const out = new Set<string>(["_row_id", "idx"]);
    for (const child of tableField.child_fields) {
      const lvl = child.perm_level ?? 0;
      if (writableLevels.has(lvl) && !child.read_only) out.add(child.fieldname);
    }
    return out;
  }

  /**
   * Filter incoming write data to only the fields the user may write (based on
   * perm_level + read_only). Mirrors filterFieldsForRead: recurses into Table
   * fields with per-child-field masking. Strips silently: an update merges the
   * result, so a stripped top-level field keeps its stored value. A Table is
   * stored whole, so on an update (`contextDoc`) each row matched by `_row_id`
   * takes the child fields the user may not write from its stored row; a new
   * row has none and gets its defaults downstream. `_`-prefixed meta keys
   * always pass.
   */
  filterFieldsForWrite(
    user: UserContext,
    entityName: string,
    data: Record<string, unknown>,
    contextDoc?: Record<string, unknown>,
  ): Record<string, unknown> {
    // Row-level gates (if_owner/condition/scope) are evaluated against the EXISTING
    // doc on an update (passed as contextDoc), NOT the partial write payload — the
    // payload may omit `owner`, which would wrongly fail if_owner and over-strip. On
    // create there is no contextDoc; the creator is the owner, so if_owner admits.
    const writableFields = this.getWritableFields(user, entityName, contextDoc);
    if (!writableFields) return data; // null = all writable (admin / unrestricted)

    const entity = this.registry.get(entityName);
    const tableFields = new Map(
      entity.fields.filter((f) => f.fieldtype === "Table").map((f) => [f.fieldname, f] as const),
    );

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!(writableFields.has(key) || key.startsWith("_"))) continue;

      if (tableFields.has(key) && Array.isArray(value)) {
        const allowedChildKeys = this.getWritableChildFields(user, entityName, key, contextDoc);
        if (allowedChildKeys === null) {
          filtered[key] = value;
        } else {
          const storedTable = contextDoc?.[key];
          const storedRows = new Map<string, Record<string, unknown>>();
          for (const stored of Array.isArray(storedTable) ? (storedTable as Array<Record<string, unknown>>) : []) {
            const rowId = stored?.[ROW_ID_FIELD];
            if (typeof rowId === "string" && rowId !== "") storedRows.set(rowId, stored);
          }
          filtered[key] = (value as Array<Record<string, unknown>>).map((row) => {
            const filteredRow: Record<string, unknown> = {};
            const rowId = row[ROW_ID_FIELD];
            const stored = typeof rowId === "string" ? storedRows.get(rowId) : undefined;
            for (const [k, v] of Object.entries(stored ?? {})) {
              if (!allowedChildKeys.has(k) && !k.startsWith("_")) filteredRow[k] = v;
            }
            for (const [k, v] of Object.entries(row)) {
              if (allowedChildKeys.has(k) || k.startsWith("_")) filteredRow[k] = v;
            }
            return filteredRow;
          });
        }
        continue;
      }

      filtered[key] = value;
    }

    // A12: enforce conditional field-locks (read_only_depends_on) server-side —
    // they were UI-only, so a non-browser write could change a locked field.
    // Reject only a write that actually CHANGES a currently-locked field vs its
    // stored value (a normal UI save resends the unchanged value, which passes).
    // Only meaningful on update (a prior value exists). The lock is evaluated
    // against the RESULTING doc so a write that itself unlocks the field is
    // allowed (matches the UI's re-evaluation).
    if (contextDoc) {
      const resultingDoc = { ...contextDoc, ...filtered };
      for (const field of entity.fields) {
        if (!field.read_only_depends_on) continue;
        if (!(field.fieldname in filtered)) continue;
        const locked = evaluateExpression(field.read_only_depends_on, {
          doc: resultingDoc,
          user: user as unknown as Record<string, unknown>,
        }); // safeDefault=true → fail-closed lock, matching the UI
        if (!locked) continue;
        if (JSON.stringify(filtered[field.fieldname]) !== JSON.stringify(contextDoc[field.fieldname])) {
          throw new PermissionDeniedError("permission_denied_locked_field", {
            doctype: entityName,
            field: field.fieldname,
          });
        }
      }
      for (const [tableName, tableField] of tableFields) {
        if (!(tableName in filtered)) continue;
        this.assertChildLocksKept(user, entityName, tableField, filtered[tableName], contextDoc[tableName]);
      }
    }

    return filtered;
  }

  /**
   * The Table counterpart of the read_only_depends_on lock above. The condition
   * sees the row as `doc`, as the grid evaluates it, with the stored values of
   * the cells the write leaves out. A Table save stores its rows whole, so a
   * writable cell left out of a row is erased, which changes it, and a stored row
   * no sent row names by `_row_id` is deleted: it may not hold a cell whose
   * condition holds on the stored row. A value that is not a list deletes every
   * row. A new row has no stored value to keep, and a cell the write filter
   * strips carries its stored value again, so it is no change.
   */
  private assertChildLocksKept(
    user: UserContext,
    entityName: string,
    tableField: FieldDefinition,
    rows: unknown,
    storedRows: unknown,
  ): void {
    const lockable = tableField.child_fields?.filter((c) => c.read_only_depends_on) ?? [];
    if (lockable.length === 0 || !Array.isArray(storedRows)) return;
    const storedById = new Map(
      (storedRows as Array<Record<string, unknown>>).map((r) => [r["_row_id"], r] as const),
    );
    const keptRowIds = new Set<unknown>();
    for (const row of (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>) {
      const stored = row["_row_id"] === undefined ? undefined : storedById.get(row["_row_id"]);
      if (!stored) continue;
      keptRowIds.add(row["_row_id"]);
      const resultingRow = { ...stored, ...row };
      for (const child of lockable) {
        if (JSON.stringify(row[child.fieldname] ?? null) === JSON.stringify(stored[child.fieldname] ?? null)) continue;
        const locked = evaluateExpression(child.read_only_depends_on!, {
          doc: resultingRow,
          user: user as unknown as Record<string, unknown>,
        });
        if (locked) {
          throw new PermissionDeniedError("permission_denied_locked_cell", {
            doctype: entityName,
            cell: `${tableField.fieldname}.${child.fieldname}`,
          });
        }
      }
    }
    for (const stored of storedRows as Array<Record<string, unknown>>) {
      if (keptRowIds.has(stored["_row_id"])) continue;
      const locked = lockable.find((child) =>
        evaluateExpression(child.read_only_depends_on!, {
          doc: stored,
          user: user as unknown as Record<string, unknown>,
        }),
      );
      if (locked) {
        throw new PermissionDeniedError("permission_denied_locked_row", {
          doctype: entityName,
          cell: `${tableField.fieldname}.${locked.fieldname}`,
        });
      }
    }
  }

  /**
   * Filter document data to only include fields the user can read. Recurses
   * into Table fields, applying per-child-field `perm_level` masking when
   * the entity declares any gated child field. `sharedForRead`: the document is
   * shared with the user for reading, which shows what a level-0 read shows.
   */
  filterFieldsForRead(
    user: UserContext,
    entityName: string,
    data: Record<string, unknown>,
    sharedForRead = false,
  ): Record<string, unknown> {
    const readableFields = this.getReadableFields(user, entityName, data, sharedForRead);

    // null means all fields are readable
    if (!readableFields) return data;

    const entity = this.registry.get(entityName);
    const tableFields = new Map(
      entity.fields.filter((f) => f.fieldtype === "Table").map((f) => [f.fieldname, f] as const),
    );

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!(readableFields.has(key) || key.startsWith("_"))) continue;

      // Mask child-field rows when the Table declares any gated child.
      if (tableFields.has(key) && Array.isArray(value)) {
        const allowedChildKeys = this.getReadableChildFields(user, entityName, key, data, sharedForRead);
        if (allowedChildKeys === null) {
          filtered[key] = value;
        } else {
          filtered[key] = (value as Array<Record<string, unknown>>).map((row) => {
            const filteredRow: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(row)) {
              if (allowedChildKeys.has(k) || k.startsWith("_")) {
                filteredRow[k] = v;
              }
            }
            return filteredRow;
          });
        }
        continue;
      }

      filtered[key] = value;
    }

    return filtered;
  }

  private permissionGrantsAction(perm: EntityPermission, action: string): boolean {
    switch (action) {
      case "select":
        return perm.select === 1;
      case "read":
        return perm.read === 1;
      case "write":
        return perm.write === 1;
      case "create":
        return perm.create === 1;
      case "delete":
        return perm.delete === 1;
      case "submit":
        return perm.submit === 1;
      case "cancel":
        return perm.cancel === 1;
      case "amend":
        return perm.amend === 1;
      case "print":
        return perm.print === 1;
      case "email":
        return perm.email === 1;
      case "export":
        return perm.export === 1;
      case "import":
        return perm.import === 1;
      case "share":
        return perm.share === 1;
      case "report":
        return perm.report === 1;
      default:
        return false;
    }
  }
}

function entityHasStateStripOverrides(entity: EntityDefinition): boolean {
  const states = entity.states;
  if (!states || states.length === 0) return false;
  for (const s of states) {
    if (s.permissions && s.permissions.length > 0) return true;
  }
  return false;
}

/** The stored fields every readable row shows: what the row is and when it changed. */
const IDENTITY_FIELDS = ["_id", "doctype", "docstatus", "creation", "modified"] as const;
/** The stored fields that name the people who wrote a row. A read row with `fields` hides them. */
const OPERATOR_FIELDS = ["owner", "modified_by"] as const;

/** The part of a read row that decides which fields it opens. */
type ReadRow = Pick<EntityPermission, "level" | "fields">;

/** Whether `row` opens the field `fieldname` of `level`, or a child of `level` of the Table
 *  `fieldname`: the row's level, and its `fields`, when it has them, name the field. */
function opensField(row: ReadRow, fieldname: string, level: number): boolean {
  return row.level === level && (!row.fields || row.fields.includes(fieldname));
}

/** Whether `rows` open `owner` and `modified_by`: unless every one of them carries `fields`. */
function opensOperatorFields(rows: readonly ReadRow[]): boolean {
  return rows.length === 0 || rows.some((row) => !row.fields);
}

/** Whether a list reads what `opens` picks on every row it answers through `rows`, the user's
 *  rows that grant it: a row that holds on every row opens it, or else each level-0 row must,
 *  since a record answers only where one of them admits it. */
function opensOnEveryListedRow(rows: readonly EntityPermission[], opens: (row: ReadRow) => boolean): boolean {
  const level0 = rows.filter((row) => row.level === 0);
  const holdsEverywhere = (row: EntityPermission) => !row.if_owner && !row.condition && !row.scope;
  return rows.some((row) => holdsEverywhere(row) && opens(row)) || (level0.length > 0 && level0.every(opens));
}
