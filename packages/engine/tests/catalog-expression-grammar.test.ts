import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseExpression, rootFieldsOf, stripEvalPrefix } from "@digitaplatform/shared";
import { evaluateExpression } from "../src/core/expression/expression-evaluator.js";
import { evaluateExpression as evaluateRuleExpression } from "../src/core/rules/rule-expression.js";
import { evaluateExpr as appNow } from "../../app/src/lib/expression.js";
import { evaluateExpr as formBefore } from "./fixtures/legacy-expression/form-evaluator.js";
import {
  evaluateExpression as engineBefore,
  evaluateExpressionValueIn as ruleBefore,
} from "./fixtures/legacy-expression/engine-evaluator.js";
import { catalogAppDir } from "./_catalog-apps.js";

/**
 * Every expression of the catalogs, under the evaluator that reads it now and under the ones that
 * read it before the shared grammar, so a catalog expression whose meaning changes is named here
 * instead of found on a record. The catalogs are checkouts next to this repository, or the folders
 * CATALOG_DIRS names (separated by ":").
 */

const PLATFORM = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const CATALOGS = (process.env["CATALOG_DIRS"]?.split(":") ?? [
  join(PLATFORM, "../digita-catalog"),
  join(PLATFORM, "../digita-catalog-show"),
  join(PLATFORM, "../digita-catalog-simetrix"),
]).map((dir) => resolve(dir));

const FIELD_EXPRESSION_KEYS = ["depends_on", "mandatory_depends_on", "read_only_depends_on"] as const;
const USER = { email: "rita@example.com", roles: ["System Manager"] };
const NOW = new Date("2026-10-03T12:00:00Z");

interface Field {
  fieldname: string;
  fieldtype?: string;
  child_fields?: Field[];
  [key: string]: unknown;
}

interface Entity {
  name: string;
  fields?: Field[];
  transitions?: { condition?: string }[];
  actions?: { action?: string; show_if?: string }[];
  reports?: { report?: string; show_if?: string }[];
  permissions?: { role?: string; condition?: string }[];
}

interface RuleAction {
  condition?: string;
  iterate?: string;
  value?: string;
  target_name?: string;
  field_mappings?: Record<string, string>;
}

/**
 * Who reads a slot decides what it is compared with: a field expression, a transition condition
 * and a permission condition are read by the form and the engine; an action's show_if only by the
 * engine; a report link's show_if only by the app, where a bare word is text; a rule's slots only
 * by the rule engine, over the rule roots.
 */
type Slot = "field" | "action" | "report" | "rule";

interface CatalogExpression {
  where: string;
  expression: string;
  slot: Slot;
  /** The fields of the document the expression reads as `doc`: the entity's, or a row's. */
  fields: Field[];
}

type Outcome = { value: unknown } | { error: true };

/** The values an expression is judged on, per root it reads. */
type Sample = Record<string, Record<string, unknown>>;

interface MeaningChange {
  where: string;
  expression: string;
  sample: Sample;
  before: Record<string, Outcome>;
  now: Outcome;
}

function catalogFiles(dir: string, suffix: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    // The catalog checker's fixtures are entities broken on purpose, which no app loads.
    if (entry.isDirectory() && !path.endsWith(join("tests", "fixtures"))) files.push(...catalogFiles(path, suffix));
    else if (entry.name.endsWith(suffix)) files.push(path);
  }
  return files;
}

function evalStrings(value: unknown, path: string, found: [string, string][]): void {
  if (typeof value === "string") {
    if (value.trim().startsWith("eval:")) found.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => evalStrings(item, `${path}[${i}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) evalStrings(item, path ? `${path}.${key}` : key, found);
  }
}

/** A `$…` token of a rule's value slot is resolved, not evaluated, so it is no expression. */
const isRuleToken = (value: string) => value.trim().startsWith("$");

function catalogExpressions(catalog: string): CatalogExpression[] {
  const expressions: CatalogExpression[] = [];
  const add = (where: string, expression: unknown, slot: Slot, fields: Field[]) => {
    if (typeof expression === "string" && expression.trim()) expressions.push({ where, expression, slot, fields });
  };
  const fieldsOf = new Map<string, Field[]>();
  for (const file of catalogFiles(catalog, ".entity.json")) {
    const entity = JSON.parse(readFileSync(file, "utf8")) as Entity;
    const at = `${relative(join(catalog, ".."), file)}: ${entity.name}`;
    const fields = entity.fields ?? [];
    fieldsOf.set(entity.name, fields);
    const visit = (owner: Field[], field: Field, path: string) => {
      for (const key of FIELD_EXPRESSION_KEYS) add(`${at}.${path}.${key}`, field[key], "field", owner);
      for (const child of field.child_fields ?? []) visit(field.child_fields!, child, `${path}.${child.fieldname}`);
    };
    for (const field of fields) visit(fields, field, field.fieldname);
    entity.transitions?.forEach((t, i) => add(`${at} transitions[${i}].condition`, t.condition, "field", fields));
    entity.actions?.forEach((a, i) => add(`${at} actions[${i}].show_if`, a.show_if, "action", fields));
    entity.reports?.forEach((r, i) => add(`${at} reports[${i}].show_if`, r.show_if, "report", fields));
    entity.permissions?.forEach((p, i) => {
      // An `eval:` condition is collected below with every other `eval:` string.
      if (!p.condition?.trim().startsWith("eval:")) add(`${at} permissions[${i}].condition`, p.condition, "field", fields);
    });
    const evals: [string, string][] = [];
    evalStrings(entity, "", evals);
    for (const [path, expression] of evals) add(`${at} ${path}`, expression, "field", fields);
  }
  for (const file of catalogFiles(catalog, ".rule.json")) {
    const rule = JSON.parse(readFileSync(file, "utf8")) as { _id: string; entity: string; condition?: string; actions?: RuleAction[] };
    const at = `${relative(join(catalog, ".."), file)}: ${rule._id}`;
    const fields = fieldsOf.get(rule.entity) ?? [];
    add(`${at} condition`, rule.condition, "rule", fields);
    rule.actions?.forEach((action, i) => {
      add(`${at} actions[${i}].condition`, action.condition, "rule", fields);
      add(`${at} actions[${i}].iterate`, action.iterate, "rule", fields);
      const values: [string, string | undefined][] = [
        ["value", action.value],
        ["target_name", action.target_name],
        ...Object.entries(action.field_mappings ?? {}).map(([key, value]): [string, string] => [`field_mappings.${key}`, value]),
      ];
      for (const [key, value] of values) {
        if (value && !isRuleToken(value)) add(`${at} actions[${i}].${key}`, value, "rule", fields);
      }
    });
  }
  return expressions;
}

function quotedLiterals(expression: string): unknown[] {
  return [...expression.matchAll(/'([^']*)'|"([^"]*)"|\b(\d+(?:\.\d+)?)\b/g)].map(([, single, double, number]) =>
    number !== undefined ? Number(number) : (single ?? double),
  );
}

function samplesOf(fieldtype: string | undefined): unknown[] {
  switch (fieldtype) {
    case "Check":
      return [0, 1, false, true];
    case "Int":
    case "Float":
    case "Currency":
    case "Percent":
    case "Rating":
      return [0, 5];
    case "Table":
      return [[], [{}]];
    default:
      return ["", "x"];
  }
}

/**
 * The samples an expression is judged on: every mix of a few values of the fields it reads. A rule
 * also reads the row and the item it iterates, whose fields have no declared type here.
 */
function samples({ expression, slot, fields }: CatalogExpression): Sample[] {
  const node = parseExpression(stripEvalPrefix(expression));
  let found: Sample[] = [{ doc: {} }];
  for (const root of slot === "rule" ? ["doc", "row", "item"] : ["doc"]) {
    for (const name of rootFieldsOf(node, root) ?? []) {
      const fieldtype = root === "doc" ? fields.find((f) => f.fieldname === name)?.fieldtype : undefined;
      const values = [null, ...new Set([...quotedLiterals(expression), ...samplesOf(fieldtype)])];
      found = found.flatMap((sample) => values.map((value) => ({ ...sample, [root]: { ...sample[root], [name]: value } })));
    }
  }
  return found;
}

type Judge = (expression: string, sample: Sample) => Outcome;

const formJudge: Judge = (expression, { doc }) => {
  const result = formBefore(expression, { doc: doc!, user: USER });
  return result.error ? { error: true } : { value: result.value };
};

/** The engine answers a broken expression with the default its caller gives. */
const engineJudge =
  (judge: typeof evaluateExpression): Judge =>
  (expression, { doc }) => {
    const open = judge(expression, { doc: doc!, user: USER }, true);
    const closed = judge(expression, { doc: doc!, user: USER }, false);
    return open === closed ? { value: open } : { error: true };
  };

const appJudge: Judge = (expression, { doc }) => {
  const result = appNow(expression, { doc: doc!, user: USER, hasBareWords: true });
  return result.error ? { error: true } : { value: result.value };
};

/** A rule's slot answers a value, and a broken one throws inside the triggering transaction. */
const ruleJudge =
  (evaluate: (expression: string, roots: Record<string, unknown>) => unknown): Judge =>
  (expression, sample) => {
    const roots = { doc: sample["doc"], row: sample["row"], item: sample["item"], item_index: undefined, user: USER, now: NOW };
    try {
      return { value: evaluate(expression, roots) };
    } catch {
      return { error: true };
    }
  };

const JUDGES: Record<Slot, { before: Record<string, Judge>; now: Judge }> = {
  field: { before: { form: formJudge, engine: engineJudge(engineBefore) }, now: engineJudge(evaluateExpression) },
  action: { before: { engine: engineJudge(engineBefore) }, now: engineJudge(evaluateExpression) },
  report: { before: { form: formJudge }, now: appJudge },
  rule: { before: { engine: ruleJudge(ruleBefore) }, now: ruleJudge(evaluateRuleExpression) },
};

function meaningChanges(expressions: CatalogExpression[]): MeaningChange[] {
  const changes: MeaningChange[] = [];
  for (const entry of expressions) {
    const judges = JUDGES[entry.slot];
    for (const sample of samples(entry)) {
      const now = judges.now(entry.expression, sample);
      const before = Object.fromEntries(
        Object.entries(judges.before).map(([reader, judge]) => [reader, judge(entry.expression, sample)]),
      );
      if (Object.values(before).some((outcome) => JSON.stringify(outcome) !== JSON.stringify(now))) {
        changes.push({ where: entry.where, expression: entry.expression, sample, before, now });
      }
    }
  }
  return changes;
}

/**
 * The meaning changes the shared grammar brings to the catalogs. The form stores a ticked Check as 1
 * and an unticked one as 0; the old form compared them with true and false as unequal, and hid the
 * field or the transition button, while the engine compared them as equal, as the shared grammar does.
 */
function knownChanges(catalog: string): MeaningChange[] {
  if (!["digita-catalog", "digita-catalog-show"].includes(basename(catalog))) return [];
  const entities = join(catalogAppDir(catalog, "workshop"), "operations/entities");
  const at = (file: string, entity: string) => `${relative(join(catalog, ".."), join(entities, file))}: ${entity}`;
  const checkReadByTheOldForm = (where: string, expression: string, doc: Record<string, unknown>): MeaningChange => ({
    where,
    expression,
    sample: { doc },
    before: { form: { value: false }, engine: { value: true } },
    now: { value: true },
  });
  const bike = at("bike.entity.json", "Bike");
  const workOrder = at("work-order.entity.json", "WorkOrder");
  const partsReady = "doc.parts_booked == true || doc.parts_count == 0";
  return [
    checkReadByTheOldForm(`${bike}.motor_brand.depends_on`, "doc.is_ebike == true", { is_ebike: 1 }),
    checkReadByTheOldForm(`${bike}.battery_wh.depends_on`, "doc.is_ebike == true", { is_ebike: 1 }),
    checkReadByTheOldForm(`${workOrder} transitions[1].condition`, "doc.quote_required == false", { quote_required: 0 }),
    checkReadByTheOldForm(`${workOrder} transitions[2].condition`, "doc.quote_required == true", { quote_required: 1 }),
    checkReadByTheOldForm(`${workOrder} transitions[3].condition`, "doc.quote_accepted == true", { quote_accepted: 1 }),
    checkReadByTheOldForm(`${workOrder} transitions[7].condition`, partsReady, { parts_booked: 1, parts_count: null }),
    checkReadByTheOldForm(`${workOrder} transitions[7].condition`, partsReady, { parts_booked: 1, parts_count: 5 }),
  ];
}

describe.each(CATALOGS)("the expressions of %s", (catalog) => {
  const present = existsSync(catalog);
  const expressions = present ? catalogExpressions(catalog) : [];

  it.skipIf(!present)("has expressions to judge", () => {
    expect(expressions.length).toBeGreaterThan(0);
  });

  it.skipIf(!present)("parse under the shared grammar", () => {
    const broken = expressions.filter(({ expression }) => {
      try {
        parseExpression(stripEvalPrefix(expression));
        return false;
      } catch {
        return true;
      }
    });
    expect(broken.map(({ where, expression }) => `${where}: ${expression}`)).toEqual([]);
  });

  it.skipIf(!present)("mean what they meant before, except the known changes", () => {
    expect(meaningChanges(expressions)).toEqual(knownChanges(catalog));
  });
});
