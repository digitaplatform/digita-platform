import type { ClientSession } from "mongodb";
import type { RuleExprContext } from "./rule-expression.js";

export type RuleActionType =
  | "create_document"
  | "update_document"
  | "validate"
  | "set_value";

/**
 * The lifecycle events the DocumentService actually dispatches rules on (single
 * source of truth — the Rule.entity.json event Select must equal this set, and
 * the seed lint rejects any rule authored against an event outside it). Dynamic
 * workflow-transition events (`on_workflow_transition:<from>:<to>`) are matched
 * separately by WORKFLOW_EVENT_RE.
 */
export const DISPATCHED_RULE_EVENTS = new Set<string>([
  "validate",
  "before_save",
  "on_update",
  "before_submit",
  "on_submit",
  "before_cancel",
]);

/**
 * The only events at which a `set_value` action may run: PRE-WRITE points where
 * the in-memory mutation still flows through Zod (validate) or is persisted via
 * getChanges() (before_submit). At any later/post-write event a set_value is
 * rejected (seed lint + runtime gate) — it would otherwise be silently dropped.
 */
export const SET_VALUE_EVENTS = new Set<string>(["validate", "before_submit"]);

/** Matches the dynamic workflow-transition event names (file-authored only). */
export const WORKFLOW_EVENT_RE = /^on_workflow_transition:.+:.+$/;

export interface RuleAction {
  type: RuleActionType;
  target_entity?: string;
  target_name?: string;
  /** Path to outer array to walk (e.g. `doc.lines`). When set, the mapping
   *  runs once per element with that element bound to `row`. */
  iterate?: string;
  /** Field name on each row whose array we walk in a second loop. When set,
   *  the mapping runs once per inner element, with the inner element bound
   *  to `item` (and `row` still pointing to its parent). Useful for
   *  materializing N child records per outer row (e.g. one per element of
   *  a line's inner array). */
  iterate_child?: string;
  field_mappings?: Record<string, string>;
  field?: string;
  value?: string;
  condition?: string;
  /** Human-readable error message thrown by `validate`. `message` is the
   *  preferred key for new rules; `error_message` is kept for compat. */
  message?: string;
  error_message?: string;
}

export interface RuleDefinition {
  _id: string;
  label: string;
  entity: string;
  event: string;
  enabled?: boolean;
  priority?: number;
  condition?: string;
  actions: RuleAction[];
  overridden?: boolean;
}

export interface RuleExecContext extends RuleExprContext {
  session?: ClientSession;
  entityName?: string;
  /**
   * Accumulated `set_value` mutations for this dispatch. `executeSetValue`
   * writes both `exec.doc[field]` (so later actions/rules observe it) AND here;
   * the DocumentService dispatch site marks each key dirty so getChanges()
   * persists it (a bare `_data` mutation would otherwise be dropped — see
   * base-document.ts:130-138). Shared across all rules in one `execute()`.
   */
  mutations: Record<string, unknown>;
}
