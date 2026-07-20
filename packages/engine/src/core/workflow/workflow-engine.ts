import type { ClientSession } from "mongodb";
import type {
  EntityDefinition,
  StateDefinition,
  StatePermissionOverride,
  TransitionDefinition,
} from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import type { RuleEngine } from "../rules/rule-engine.js";
import type { UserContext } from "../permissions/types.js";
import { evaluateExpression } from "../expression/expression-evaluator.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("workflow-engine");

export class IllegalTransitionError extends Error {
  constructor(
    public entity: string,
    public from: string | undefined,
    public to: string,
    public reason:
      | "not_declared"
      | "role_denied"
      | "condition_failed"
      | "from_terminal"
      | "no_initial_state",
  ) {
    super(`Illegal workflow transition on ${entity}: ${from ?? "(initial)"} → ${to} (${reason})`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * First-class state-machine engine.
 *
 * Schema model:
 *   State lives on a regular field (default `status`, configurable per
 *     entity via `workflow_field`). Coexists with `docstatus` (0/1/2) which
 *     is managed independently by `docstatus-engine`.
 *   `entity.states[]` declares the named states. One should carry
 *     `is_initial: true`.
 *   `entity.transitions[]` declares the legal `(from, to)` pairs, allowed
 *     roles, optional condition, and `side_effects.set` field stamps.
 *   `state.permissions[]` lets a state STRIP permissions from a base role
 *     (logical AND with the entity's permissions block). Stripping only —
 *     a state cannot grant beyond what the base allows.
 *
 * Lifecycle wiring:
 *   `DocumentService.insert` calls `getInitialState` and stamps it onto
 *     the doc when the workflow field isn't already set.
 *   `DocumentService.update` detects a workflow-field change, calls
 *     `validateTransition` BEFORE the transactional block, then inside the
 *     transaction calls `applyTransition` (which RETURNS the
 *     `side_effects.set` map for the caller to `doc.merge`) and fires the
 *     `on_workflow_transition:<from>:<to>` rule event.
 *   `PermissionChecker` consults `resolveStateOverride` via late binding
 *     to apply per-state permission deltas.
 *
 * Boot:
 *   `validateDefinition` returns warnings when the declarative model is
 *     internally inconsistent (multiple is_initial, dangling transitions,
 *     terminal-state outgoing transitions). Warnings are logged; the
 *     entity continues to load.
 */
/**
 * A generic docstatus flip (submit → 1 / cancel → 2) could not pick a single target
 * state because several states share that `doc_status` and none (or more than one)
 * carries `docstatus_default`. Fail loud: the entity author must declare which state
 * the flip lands in, rather than the engine guessing by declaration order.
 */
export class AmbiguousDocStatusStateError extends Error {
  constructor(
    public entity: string,
    public docStatus: 0 | 1 | 2,
    public candidates: string[],
    public reason: "no_default" | "multiple_default",
  ) {
    super(
      `Ambiguous state for docstatus ${docStatus} on ${entity}: candidates [${candidates.join(
        ", ",
      )}] (${reason}). Declare docstatus_default:true on exactly one.`,
    );
    this.name = "AmbiguousDocStatusStateError";
  }
}

export class WorkflowEngine {
  constructor(private ruleEngine?: RuleEngine) {}

  setRuleEngine(ruleEngine: RuleEngine): void {
    this.ruleEngine = ruleEngine;
  }

  /** True when the entity declares any states or transitions. */
  hasWorkflow(entity: EntityDefinition): boolean {
    return !!(entity.states?.length || entity.transitions?.length);
  }

  /** Default workflow field is `status`; `workflow_field` can override. */
  getWorkflowField(entity: EntityDefinition): string {
    return entity.workflow_field ?? "status";
  }

  /** Returns the value of the state marked `is_initial: true`, if any. */
  getInitialState(entity: EntityDefinition): string | undefined {
    const initial = (entity.states ?? []).filter((s) => s.is_initial);
    if (initial.length === 0) return undefined;
    if (initial.length > 1) {
      log.warn(
        { entity: entity.name, count: initial.length },
        "multiple is_initial states declared — using the first",
      );
    }
    return initial[0]!.value;
  }

  /**
   * Pick the state a generic docstatus flip (submit → 1 / cancel → 2) lands in.
   * Resolution is by EXPLICIT DECLARATION, not declaration order:
   *   1. exactly one state carries `docstatus_default` → that one;
   *   2. else exactly one state has this doc_status → that one (unambiguous);
   *   3. else exactly one NON-TERMINAL candidate → that one (a submit lands in the
   *      single entry state; terminal siblings like "paid"/"delivered" are reached
   *      by later transitions, not the flip);
   *   4. else FAIL LOUD (AmbiguousDocStatusStateError) — e.g. two terminal states at
   *      doc_status 2 ("expired"/"cancelled"): the author must flag docstatus_default.
   *
   * Returns `undefined` when the entity declares no workflow or no state matches the
   * given doc_status — caller leaves the field alone.
   */
  getStateForDocStatus(entity: EntityDefinition, docStatus: 0 | 1 | 2): string | undefined {
    if (!this.hasWorkflow(entity)) return undefined;
    const matches = (entity.states ?? []).filter((s) => s.doc_status === docStatus);
    if (matches.length === 0) return undefined;
    if (matches.length === 1) return matches[0]!.value;

    const flagged = matches.filter((s) => s.docstatus_default === true);
    if (flagged.length === 1) return flagged[0]!.value;
    if (flagged.length > 1) {
      throw new AmbiguousDocStatusStateError(
        entity.name,
        docStatus,
        flagged.map((s) => s.value),
        "multiple_default",
      );
    }

    const nonTerminal = matches.filter((s) => !s.is_terminal);
    if (nonTerminal.length === 1) return nonTerminal[0]!.value;

    throw new AmbiguousDocStatusStateError(
      entity.name,
      docStatus,
      matches.map((s) => s.value),
      "no_default",
    );
  }

  /**
   * Validate a from→to workflow change. Throws `IllegalTransitionError` on
   * any failure. The caller is `DocumentService.update`.
   */
  validateTransition(
    entity: EntityDefinition,
    doc: Record<string, unknown>,
    fromValue: string | undefined,
    toValue: string,
    user: UserContext,
  ): TransitionDefinition | undefined {
    if (!this.hasWorkflow(entity)) return undefined;

    // Administrators bypass workflow gates (consistent with permission-checker).
    const isAdmin = user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR);

    // The new state must be declared.
    const toState = (entity.states ?? []).find((s) => s.value === toValue);
    if (!toState) {
      throw new IllegalTransitionError(entity.name, fromValue, toValue, "not_declared");
    }

    // Find a transition that matches (from, to). Wildcard `from: "*"` allowed.
    const matching = (entity.transitions ?? []).filter(
      (t) => (t.from === fromValue || t.from === "*") && t.to === toValue,
    );

    // Administrators bypass role/condition gates but still stamp the side
    // effects of a matching transition (the first, if several are declared).
    // Admin may transition even when no transition is declared -> undefined,
    // in which case applyTransition stamps nothing.
    if (isAdmin) return matching[0];

    if (matching.length === 0) {
      // Terminal = "no exit UNLESS a transition is explicitly declared". A matching
      // declared transition (found above) can leave a terminal state (e.g. Reopen);
      // a genuine dead-end with no declared exit still reports from_terminal.
      const fromState = (entity.states ?? []).find((s) => s.value === fromValue);
      const reason = fromState?.is_terminal ? "from_terminal" : "not_declared";
      throw new IllegalTransitionError(entity.name, fromValue, toValue, reason);
    }

    // At least one matching transition must accept the user's roles AND its condition.
    const userRoles = new Set(user.roles);
    let lastFailure: "role_denied" | "condition_failed" = "role_denied";
    for (const t of matching) {
      const roleOk = t.allowed_roles.length === 0 || t.allowed_roles.some((r) => userRoles.has(r));
      if (!roleOk) continue;
      if (t.condition) {
        const ok = evaluateExpression(t.condition, {
          doc,
          user: user as unknown as Record<string, unknown>,
        });
        if (!ok) {
          lastFailure = "condition_failed";
          continue;
        }
      }
      return t; // accepted
    }
    throw new IllegalTransitionError(entity.name, fromValue, toValue, lastFailure);
  }

  /**
   * Resolve the transition's `side_effects.set` map and fire the
   * `on_workflow_transition:<from>:<to>` rule event. Called INSIDE the
   * caller's transaction so any rule-driven child writes roll back together.
   *
   * RETURNS the side-effects map (possibly empty) for the caller to apply via
   * `doc.merge(...)` — it does NOT mutate the passed record. This is
   * load-bearing, not stylistic: `BaseDocument.set()` short-circuits when
   * old === new, so if applyTransition pre-mutated `doc._data[k] = v` the
   * subsequent `doc.merge({ k: v })` would register NOTHING dirty and the
   * side-effect field would be dropped by `getChanges()` at the write (the
   * exact latent bug this return-based contract fixes). Rules still OBSERVE the
   * post-side-effect state via a merged view, without that view leaking back
   * into the caller's record.
   */
  async applyTransition(
    entity: EntityDefinition,
    doc: Record<string, unknown>,
    transition: TransitionDefinition | undefined,
    fromValue: string | undefined,
    toValue: string,
    user: UserContext,
    session: ClientSession,
  ): Promise<Record<string, unknown>> {
    if (!this.hasWorkflow(entity)) return {};
    // Collect ONLY the transition that authorized this change — not every
    // (from,to) match — so a forbidden sibling transition's side effects
    // (its role/condition gate failed) never fire.
    const sideEffects: Record<string, unknown> = { ...(transition?.side_effects?.set ?? {}) };
    if (this.ruleEngine) {
      const event = `on_workflow_transition:${fromValue ?? "*"}:${toValue}`;
      // Rules see the post-side-effect state via a merged VIEW — a copy, so
      // nothing leaks back into the caller's record (see method doc).
      await this.ruleEngine.execute(entity.name, event, { ...doc, ...sideEffects }, user, session);
    }
    return sideEffects;
  }

  /**
   * Resolve the per-role permission override for the doc's current state.
   * Returns `null` when no override applies. Used by `PermissionChecker`
   * via late binding (avoids the circular DI: PermissionChecker →
   * WorkflowEngine → RuleEngine → DocumentService → PermissionChecker).
   */
  resolveStateOverride(
    entity: EntityDefinition,
    doc: Record<string, unknown> | undefined,
    role: string,
  ): StatePermissionOverride | null {
    if (!doc || !this.hasWorkflow(entity)) return null;
    const wf = this.getWorkflowField(entity);
    const value = doc[wf];
    if (typeof value !== "string") return null;
    const state = (entity.states ?? []).find((s) => s.value === value);
    if (!state?.permissions?.length) return null;
    return state.permissions.find((p) => p.role === role) ?? null;
  }

  /**
   * Boot-time consistency check. Returns a list of human-readable warnings;
   * the loader logs them and continues. Mirrors the platform's "warn,
   * don't fail" philosophy.
   */
  validateDefinition(entity: EntityDefinition): string[] {
    const out: string[] = [];
    if (!this.hasWorkflow(entity)) return out;
    const states = entity.states ?? [];
    const transitions = entity.transitions ?? [];
    const stateValues = new Set(states.map((s) => s.value));

    const initial = states.filter((s) => s.is_initial);
    if (initial.length > 1) {
      out.push(`multiple is_initial states: ${initial.map((s) => s.value).join(", ")}`);
    }

    for (const t of transitions) {
      if (t.from !== "*" && !stateValues.has(t.from)) {
        out.push(`transition.from "${t.from}" is not a declared state`);
      }
      if (!stateValues.has(t.to)) {
        out.push(`transition.to "${t.to}" is not a declared state`);
      }
      // NOTE: a declared transition OUT of a terminal state is now permitted
      // (terminal = "no exit unless explicitly declared", e.g. a Reopen) — so it
      // is no longer flagged here; the runtime honors it in validateTransition.
    }

    return out;
  }
}
