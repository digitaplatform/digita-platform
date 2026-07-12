import { readdir, readFile } from "fs/promises";
import { DIGITA } from "@digitaplatform/shared";
import { join } from "path";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import {
  DISPATCHED_RULE_EVENTS,
  SET_VALUE_EVENTS,
  WORKFLOW_EVENT_RE,
  type RuleActionType,
  type RuleDefinition,
} from "./rule-types.js";
import { assertExpressionParsable, assertConditionParsable } from "./rule-expression.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("rule-loader");

/** Action types the engine still executes (Select + lint must agree). */
const VALID_ACTION_TYPES = new Set<RuleActionType>([
  "create_document",
  "update_document",
  "validate",
  "set_value",
]);

/**
 * Load rules from `<appDir>/rules/**.rule.json` files and seed them into
 * the `rules` collection. Rules with `overridden=true` in mongo are NOT
 * re-seeded (admin UI modifications win).
 *
 * Fail-loud seed lints (F3): every rule is validated against BOTH its own
 * grammar and the entity registry — an undispatchable event, a set_value at a
 * post-write event, a missing target_entity, or a mapping key that is not a
 * declared (and, for update_document, `allow_on_submit`) field aborts seeding
 * so the problem surfaces at boot, not inside the first triggering transaction.
 */
export async function seedRulesFromFiles(
  db: MongoDBService,
  appDirs: string[],
  registry: EntityRegistry,
): Promise<number> {
  clearRuleCache();
  let seeded = 0;
  const invalid: string[] = [];

  for (const appDir of appDirs) {
    const rulesDir = join(appDir, "rules");
    const files = await safeReaddirRecursive(rulesDir);
    for (const file of files) {
      if (!file.endsWith(".rule.json")) continue;
      try {
        const raw = await readFile(file, "utf-8");
        const rule = JSON.parse(raw) as RuleDefinition;
        if (!rule._id || !rule.entity || !rule.event) {
          log.warn({ file }, "skipping rule: missing _id/entity/event");
          continue;
        }
        // Fail-loud guards (run even for enabled:false files — they seed too):
        // an unparsable expression or a structural violation would otherwise
        // throw at runtime inside the triggering transaction on every attempt.
        const exprError = findUnparsableRuleExpression(rule);
        if (exprError) {
          invalid.push(`${file} (rule "${rule._id}"): ${exprError}`);
          continue;
        }
        const lintError = findRuleLintError(rule, registry);
        if (lintError) {
          invalid.push(`${file} (rule "${rule._id}"): ${lintError}`);
          continue;
        }
        const existing = (await db.findOne(
          DIGITA.COLLECTIONS.RULE,
          rule._id,
          DIGITA.DATABASES.CORE,
        )) as Record<string, unknown> | null;
        if (existing && existing["overridden"] === true) {
          log.debug({ id: rule._id }, "skipping rule seed — admin-overridden");
          continue;
        }
        const now = new Date();
        const payload = {
          ...rule,
          enabled: rule.enabled ?? true,
          priority: rule.priority ?? 100,
          overridden: false,
          modified: now,
          modified_by: "system",
          owner: "system",
          creation: existing?.["creation"] ?? now,
          docstatus: 0,
        };
        if (existing) {
          await db.updateOne(DIGITA.COLLECTIONS.RULE, rule._id, payload, DIGITA.DATABASES.CORE);
        } else {
          await db.insertOne(
            DIGITA.COLLECTIONS.RULE,
            { ...payload, _id: rule._id },
            DIGITA.DATABASES.CORE,
          );
          seeded++;
        }
      } catch (err) {
        log.error({ file, err }, "failed to seed rule");
      }
    }
  }
  if (invalid.length) {
    throw new Error(
      `Rule seeding aborted — ${invalid.length} rule(s) failed validation:\n` +
        invalid.map((s) => `  - ${s}`).join("\n"),
    );
  }
  // Boot report (warn, not fail): admin-overridden mongo rows are NOT re-seeded
  // and file lints can't see them — flag any enabled row whose event is
  // undispatchable or whose action type is no longer executable.
  await reportUndispatchableRules(db);
  log.info({ seeded }, "rule seeding complete");
  return seeded;
}

/**
 * Return a human-readable error for the first STRUCTURAL problem in a rule
 * (event, action type, set_value slot, target existence, mapping keys), or null
 * when the rule is registry-valid. Complements `findUnparsableRuleExpression`
 * (which only checks expression grammar).
 */
export function findRuleLintError(rule: RuleDefinition, registry: EntityRegistry): string | null {
  if (!DISPATCHED_RULE_EVENTS.has(rule.event) && !WORKFLOW_EVENT_RE.test(rule.event)) {
    return `event "${rule.event}" is never dispatched (allowed: ${[...DISPATCHED_RULE_EVENTS].join(
      ", ",
    )} or on_workflow_transition:<from>:<to>)`;
  }
  for (const action of rule.actions ?? []) {
    if (!VALID_ACTION_TYPES.has(action.type)) {
      return `unknown action type "${action.type}" (allowed: ${[...VALID_ACTION_TYPES].join(", ")})`;
    }
    if (action.type === "set_value" && !SET_VALUE_EVENTS.has(rule.event)) {
      return `set_value is only allowed at ${[...SET_VALUE_EVENTS].join(
        ", ",
      )}, not "${rule.event}"`;
    }
    if (action.type === "create_document" || action.type === "update_document") {
      if (!action.target_entity) return `${action.type} requires target_entity`;
      if (!registry.has(action.target_entity)) {
        return `${action.type} target_entity "${action.target_entity}" does not exist`;
      }
      if (action.type === "update_document" && !action.target_name) {
        return "update_document requires target_name";
      }
      const target = registry.get(action.target_entity);
      for (const key of Object.keys(action.field_mappings ?? {})) {
        // create may address the business key _id; update never can (band gate).
        if (key === "_id" && action.type === "create_document") continue;
        const fd = target.fields.find((f) => f.fieldname === key);
        if (!fd) {
          return `${action.type} mapping key "${key}" is not a declared field on ${action.target_entity}`;
        }
        if (action.type === "update_document" && fd.allow_on_submit !== true) {
          return `update_document mapping key "${key}" is not allow_on_submit on ${action.target_entity} (post-submit band gate)`;
        }
      }
    }
  }
  return null;
}

/** Warn on admin-overridden mongo rows that can never fire / execute. */
async function reportUndispatchableRules(db: MongoDBService): Promise<void> {
  const rows = (await db.find(
    DIGITA.COLLECTIONS.RULE,
    { filters: [{ enabled: true }] },
    DIGITA.DATABASES.CORE,
  )) as unknown as RuleDefinition[];
  for (const rule of rows) {
    if (!DISPATCHED_RULE_EVENTS.has(rule.event) && !WORKFLOW_EVENT_RE.test(rule.event)) {
      log.warn({ id: rule._id, event: rule.event }, "enabled rule has an undispatchable event");
    }
    for (const action of rule.actions ?? []) {
      if (!VALID_ACTION_TYPES.has(action.type)) {
        log.warn(
          { id: rule._id, type: action.type },
          "enabled rule has a non-executable action type",
        );
      }
    }
  }
}

/**
 * Return a human-readable error for the first unparsable expression in a rule,
 * or null if every expression is syntactically valid. SLOT-AWARE (contract C):
 * condition/iterate slots are pure expressions (tokens rejected); value slots
 * (target_name, value, field_mappings values) accept `$…` tokens.
 */
export function findUnparsableRuleExpression(rule: RuleDefinition): string | null {
  const check = (expr: string, slot: "condition" | "value"): string | null => {
    try {
      if (slot === "condition") assertConditionParsable(expr);
      else assertExpressionParsable(expr);
      return null;
    } catch (err) {
      return `${(err as Error).message} in ${JSON.stringify(expr)}`;
    }
  };
  if (rule.condition) {
    const e = check(rule.condition, "condition");
    if (e) return e;
  }
  for (const action of rule.actions ?? []) {
    if (action.condition) {
      const e = check(action.condition, "condition");
      if (e) return e;
    }
    if (action.iterate) {
      const e = check(action.iterate, "condition");
      if (e) return e;
    }
    if (action.target_name) {
      const e = check(action.target_name, "value");
      if (e) return e;
    }
    if (action.value) {
      const e = check(action.value, "value");
      if (e) return e;
    }
    for (const v of Object.values(action.field_mappings ?? {})) {
      const e = check(v, "value");
      if (e) return e;
    }
  }
  return null;
}

async function safeReaddirRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await safeReaddirRecursive(full)));
      else out.push(full);
    }
  } catch {
    // dir absent — fine
  }
  return out;
}

// ── (entity,event) cache (D7 = 30s TTL v1) ──────────────────────────────────
interface RuleCacheEntry {
  at: number;
  rules: RuleDefinition[];
}
const RULE_CACHE_TTL_MS = 30_000;
const ruleCache = new Map<string, RuleCacheEntry>();

/** Drop the cache (called on (re)seed so edits become visible immediately). */
export function clearRuleCache(): void {
  ruleCache.clear();
}

/**
 * Load all enabled rules for a given (entity, event) from mongo, sorted by
 * priority. Cached per (entity,event) for RULE_CACHE_TTL_MS so the new
 * per-insert/update dispatch doesn't cost a Mongo query for the 99% of
 * entities with no rules.
 */
export async function loadActiveRules(
  db: MongoDBService,
  entity: string,
  event: string,
): Promise<RuleDefinition[]> {
  const key = `${entity}::${event}`;
  const now = Date.now();
  const hit = ruleCache.get(key);
  if (hit && now - hit.at < RULE_CACHE_TTL_MS) return hit.rules;

  const rows = await db.find(
    DIGITA.COLLECTIONS.RULE,
    {
      filters: [{ entity, event, enabled: true }],
      order_by: "priority asc",
    },
    DIGITA.DATABASES.CORE,
  );
  const rules = rows as unknown as RuleDefinition[];
  ruleCache.set(key, { at: now, rules });
  return rules;
}
