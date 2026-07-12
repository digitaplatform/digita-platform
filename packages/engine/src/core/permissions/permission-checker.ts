import type { EntityDefinition, EntityPermission, StatePermissionOverride } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { evaluateExpression } from "../expression/expression-evaluator.js";
import { scopeValueMatches } from "./scope-filter.js";
import type { UserContext, PermissionCheckResult } from "./types.js";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("permission-checker");

export class PermissionDeniedError extends Error {
  constructor(
    public user: string,
    public entity: string,
    public action: string,
  ) {
    super(`Permission denied: ${user} cannot ${action} ${entity}`);
    this.name = "PermissionDeniedError";
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
      throw new PermissionDeniedError(user.email, entityName, action);
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
    const permissions = entity.permissions;

    if (!permissions || permissions.length === 0) {
      return { allowed: false, reason: "No permissions defined" };
    }

    // Find matching permissions for user's roles at level 0
    const matchingPerms = permissions.filter((p) => p.level === 0 && user.roles.includes(p.role));

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

      // Check scope (single-doc) — gated by PERMISSION_SCOPE_ENABLED so it stays
      // inert until the principal carries the scope claim (mirrors applyScopeFilters).
      if (perm.scope && doc && env.PERMISSION_SCOPE_ENABLED) {
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
    if (perm.scope && env.PERMISSION_SCOPE_ENABLED) {
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
   * Does the user hold any read permission on this entity that carries a
   * `condition`? scope/if_owner are translated into the Mongo filter by
   * applyScopeFilters, but a `condition` is an arbitrary expression that cannot
   * be — so enumeration paths (list/count/exists/aggregate) must re-check it per
   * row. Returns false (no per-row cost) for Administrators and entities without
   * a conditional read grant for this user.
   */
  hasConditionalReadPermission(user: UserContext, entityName: string): boolean {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return false;
    const entity = this.registry.get(entityName);
    return entity.permissions.some(
      (p) => p.level === 0 && !!p.read && !!p.condition && user.roles.includes(p.role),
    );
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
   * Get all fields the user can read (based on perm_level).
   */
  getReadableFields(
    user: UserContext,
    entityName: string,
    doc?: Record<string, unknown>,
  ): Set<string> | null {
    // Administrator can read everything
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) {
      return null; // null means all fields
    }

    const entity = this.registry.get(entityName);
    const readableFields = new Set<string>();

    // Determine which perm_levels the user can read. A conditional (if_owner/
    // condition/scope) grant only contributes its level when it admits `doc`.
    const readableLevels = new Set<number>();

    for (const perm of entity.permissions) {
      if (!user.roles.includes(perm.role)) continue;
      if (perm.read && this.permMatchesDoc(perm, user, doc)) {
        readableLevels.add(perm.level);
      }
    }

    for (const field of entity.fields) {
      const level = field.perm_level ?? 0;
      if (readableLevels.has(level)) {
        readableFields.add(field.fieldname);
      }
    }

    // Always include standard fields
    readableFields.add("_id");
    readableFields.add("doctype");
    readableFields.add("docstatus");
    readableFields.add("owner");
    readableFields.add("modified_by");
    readableFields.add("creation");
    readableFields.add("modified");

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
  ): Set<string> | null {
    if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return null;
    const entity = this.registry.get(entityName);
    const tableField = entity.fields.find((f) => f.fieldname === tableFieldname);
    if (!tableField || !tableField.child_fields?.length) return null;
    const anyGated = tableField.child_fields.some((c) => (c.perm_level ?? 0) > 0);
    if (!anyGated) return null;

    const readableLevels = new Set<number>();
    for (const perm of entity.permissions) {
      if (!user.roles.includes(perm.role)) continue;
      if (perm.read && this.permMatchesDoc(perm, user, doc)) readableLevels.add(perm.level);
    }
    const out = new Set<string>(["_row_id", "idx"]);
    for (const child of tableField.child_fields) {
      const lvl = child.perm_level ?? 0;
      if (readableLevels.has(lvl)) out.add(child.fieldname);
    }
    return out;
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

    for (const perm of entity.permissions) {
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
    for (const perm of entity.permissions) {
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
   * fields with per-child-field masking. Strips silently — protected fields
   * fall back to defaults/computed/existing values downstream. `_`-prefixed
   * meta keys always pass.
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
          filtered[key] = (value as Array<Record<string, unknown>>).map((row) => {
            const filteredRow: Record<string, unknown> = {};
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
          throw new PermissionDeniedError(
            user.email,
            entityName,
            `change the locked field "${field.fieldname}" of`,
          );
        }
      }
    }

    return filtered;
  }

  /**
   * Filter document data to only include fields the user can read. Recurses
   * into Table fields, applying per-child-field `perm_level` masking when
   * the entity declares any gated child field.
   */
  filterFieldsForRead(
    user: UserContext,
    entityName: string,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const readableFields = this.getReadableFields(user, entityName, data);

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
        const allowedChildKeys = this.getReadableChildFields(user, entityName, key, data);
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
