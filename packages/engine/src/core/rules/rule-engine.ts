import type { ClientSession } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { UserContext } from "../permissions/types.js";
import { loadActiveRules } from "./rule-loader.js";
import { evaluateExpression } from "./rule-expression.js";
import { executeCreateDocument } from "./actions/create-document.js";
import { executeUpdateDocument } from "./actions/update-document.js";
import { executeValidate } from "./actions/validate-rule.js";
import { executeSetValue } from "./actions/set-value.js";
import { SET_VALUE_EVENTS } from "./rule-types.js";
import type { RuleAction, RuleDefinition, RuleExecContext } from "./rule-types.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("rule-engine");

const MAX_DEPTH = 5; // safeguard against rule chains triggering rules that trigger rules…

/**
 * Run all enabled rules for (entity, event) within the supplied transaction.
 * Skips rules whose top-level `condition` expression evaluates false.
 * On any action error the caller's transaction rolls back.
 */
export class RuleEngine {
  // Track recursion depth per session to prevent infinite rule cascades.
  private depth = new WeakMap<ClientSession, number>();
  // Late-bound to avoid the DocumentService ↔ RuleEngine construction cycle.
  // When set, `create_document` actions route through DocumentService.insert
  // so they obey field-level permissions, validators and hooks.
  private documentService?: {
    insert: (
      doctype: string,
      data: Record<string, unknown>,
      user: UserContext,
      ctx: undefined,
      session: ClientSession,
    ) => Promise<unknown>;
    // Governed post-submit band patch for `update_document` (Cluster A). The
    // full DocumentService satisfies this structurally — no app.ts change.
    updateSubmitted: (
      doctype: string,
      name: string,
      patch: { set?: Record<string, unknown> },
      user: UserContext,
      ctx: undefined,
      options: { sessionOverride: ClientSession; cause?: { doctype: string; name: string } },
    ) => Promise<unknown>;
  };

  constructor(
    private db: MongoDBService,
    private registry: EntityRegistry,
  ) {}

  setDocumentService(svc: RuleEngine["documentService"]): void {
    this.documentService = svc;
  }

  /**
   * Run all enabled rules for (entity, event) inside the caller's transaction
   * and RETURN the accumulated `set_value` mutations (`{}` when none). The
   * caller must mark each returned key dirty on its BaseDocument so getChanges()
   * persists it. At any event outside SET_VALUE_EVENTS a set_value is rejected
   * (fail loud → rollback) — a post-write mutation would otherwise be lost.
   */
  async execute(
    entity: string,
    event: string,
    doc: Record<string, unknown>,
    user: UserContext,
    session: ClientSession,
  ): Promise<Record<string, unknown>> {
    const currentDepth = this.depth.get(session) ?? 0;
    if (currentDepth >= MAX_DEPTH) {
      throw new Error(`Rule engine recursion limit (${MAX_DEPTH}) exceeded at ${entity}.${event}`);
    }

    const mutations: Record<string, unknown> = {};
    const rules = await loadActiveRules(this.db, entity, event);
    if (!rules.length) return mutations;

    this.depth.set(session, currentDepth + 1);
    try {
      for (const rule of rules) {
        await this.runRule(rule, doc, user, session, entity, mutations);
      }
    } finally {
      if (currentDepth === 0) this.depth.delete(session);
      else this.depth.set(session, currentDepth);
    }

    // Fail-loud event gate: set_value only makes it to storage at pre-write
    // events. Anywhere else (on_update / on_submit / before_cancel /
    // on_workflow_transition:*), a mutation would be silently dropped — throw
    // inside the tx instead so the whole triggering operation rolls back.
    if (Object.keys(mutations).length > 0 && !SET_VALUE_EVENTS.has(event)) {
      throw new Error(`rule engine: set_value not allowed at ${entity}.${event}`);
    }
    return mutations;
  }

  private async runRule(
    rule: RuleDefinition,
    doc: Record<string, unknown>,
    user: UserContext,
    session: ClientSession,
    entityName: string,
    mutations: Record<string, unknown>,
  ): Promise<void> {
    const exec: RuleExecContext = { doc, user, now: new Date(), session, entityName, mutations };

    if (rule.condition) {
      const ok = evaluateExpression(rule.condition, exec);
      if (!ok) {
        log.debug({ rule: rule._id }, "rule condition false; skipping");
        return;
      }
    }

    log.debug({ rule: rule._id, actions: rule.actions?.length ?? 0 }, "executing rule");

    for (const action of rule.actions ?? []) {
      await this.runAction(action, exec, session);
    }
  }

  private async runAction(
    action: RuleAction,
    exec: RuleExecContext,
    session: ClientSession,
  ): Promise<void> {
    switch (action.type) {
      case "create_document":
        return executeCreateDocument(action, exec, session, this.documentService);
      case "update_document":
        return executeUpdateDocument(action, exec, this.documentService, session);
      case "validate":
        return executeValidate(action, exec, this.db, this.registry, session);
      case "set_value":
        return executeSetValue(action, exec);
      default:
        throw new Error(`unknown rule action type: ${(action as { type?: string }).type}`);
    }
  }
}
