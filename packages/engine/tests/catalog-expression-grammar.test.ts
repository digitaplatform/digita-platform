import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseExpression, rootFieldsOf, stripEvalPrefix } from "@digitaplatform/shared";
import { evaluateExpression } from "../src/core/expression/expression-evaluator.js";
import { evaluateExpr as formBefore } from "./fixtures/legacy-expression/form-evaluator.js";
import { evaluateExpression as engineBefore } from "./fixtures/legacy-expression/engine-evaluator.js";
import { catalogAppDir } from "./_catalog-apps.js";

/**
 * Every field expression and every `eval:` expression of the catalogs, under the grammar form and
 * engine now share and under the two evaluators they had before, so a catalog expression whose
 * meaning changes is named here instead of found on a record. The catalogs are checkouts next to
 * this repository, or the folders CATALOG_DIRS names (separated by ":").
 */

const PLATFORM = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const CATALOGS = (process.env["CATALOG_DIRS"]?.split(":") ?? [
  join(PLATFORM, "../digita-catalog"),
  join(PLATFORM, "../digita-catalog-show"),
  join(PLATFORM, "../digita-catalog-simetrix"),
]).map((dir) => resolve(dir));

const FIELD_EXPRESSION_KEYS = ["depends_on", "mandatory_depends_on", "read_only_depends_on"] as const;
const USER = { email: "rita@example.com", roles: ["System Manager"] };

interface Field {
  fieldname: string;
  fieldtype?: string;
  child_fields?: Field[];
  [key: string]: unknown;
}

interface CatalogExpression {
  where: string;
  expression: string;
  /** The fields of the document the expression reads as `doc`: the entity's, or a row's. */
  fields: Field[];
}

type Outcome = { value: boolean } | { error: true };

interface MeaningChange {
  where: string;
  expression: string;
  doc: Record<string, unknown>;
  form: Outcome;
  engine: Outcome;
  now: Outcome;
}

function entityFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    // The catalog checker's fixtures are entities broken on purpose, which no app loads.
    if (entry.isDirectory() && !path.endsWith(join("tests", "fixtures"))) files.push(...entityFiles(path));
    else if (entry.name.endsWith(".entity.json")) files.push(path);
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

function catalogExpressions(catalog: string): CatalogExpression[] {
  const expressions: CatalogExpression[] = [];
  for (const file of entityFiles(catalog)) {
    const entity = JSON.parse(readFileSync(file, "utf8")) as { name: string; fields?: Field[] };
    const at = `${relative(join(catalog, ".."), file)}: ${entity.name}`;
    const fields = entity.fields ?? [];
    const visit = (owner: Field[], field: Field, path: string) => {
      for (const key of FIELD_EXPRESSION_KEYS) {
        const expression = field[key];
        if (typeof expression === "string" && expression.trim()) {
          expressions.push({ where: `${at}.${path}.${key}`, expression, fields: owner });
        }
      }
      for (const child of field.child_fields ?? []) visit(field.child_fields!, child, `${path}.${child.fieldname}`);
    };
    for (const field of fields) visit(fields, field, field.fieldname);
    const evals: [string, string][] = [];
    evalStrings(entity, "", evals);
    for (const [path, expression] of evals) expressions.push({ where: `${at} ${path}`, expression, fields });
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

/** The documents an expression is judged on: every mix of a few values of the fields it reads. */
function sampleDocs({ expression, fields }: CatalogExpression): Record<string, unknown>[] {
  const read = rootFieldsOf(parseExpression(stripEvalPrefix(expression)), "doc") ?? [];
  let docs: Record<string, unknown>[] = [{}];
  for (const name of read) {
    const fieldtype = fields.find((f) => f.fieldname === name)?.fieldtype;
    const values = [null, ...new Set([...quotedLiterals(expression), ...samplesOf(fieldtype)])];
    docs = docs.flatMap((doc) => values.map((value) => ({ ...doc, [name]: value })));
  }
  return docs;
}

function formOutcome(expression: string, doc: Record<string, unknown>): Outcome {
  const result = formBefore(expression, { doc, user: USER });
  return result.error ? { error: true } : { value: result.value };
}

/** The engine answers a broken expression with the default its caller gives. */
function engineOutcome(judge: typeof evaluateExpression, expression: string, doc: Record<string, unknown>): Outcome {
  const open = judge(expression, { doc, user: USER }, true);
  const closed = judge(expression, { doc, user: USER }, false);
  return open === closed ? { value: open } : { error: true };
}

function meaningChanges(expressions: CatalogExpression[]): MeaningChange[] {
  const changes: MeaningChange[] = [];
  for (const entry of expressions) {
    for (const doc of sampleDocs(entry)) {
      const form = formOutcome(entry.expression, doc);
      const engine = engineOutcome(engineBefore, entry.expression, doc);
      const now = engineOutcome(evaluateExpression, entry.expression, doc);
      if (JSON.stringify(now) !== JSON.stringify(form) || JSON.stringify(now) !== JSON.stringify(engine)) {
        changes.push({ where: entry.where, expression: entry.expression, doc, form, engine, now });
      }
    }
  }
  return changes;
}

/**
 * The meaning changes the shared grammar brings to the catalogs. The form stores a ticked Check as 1;
 * the old form compared 1 with true as unequal and hid the field, while the engine compared them as
 * equal, as the shared grammar does.
 */
function knownChanges(catalog: string): MeaningChange[] {
  if (!["digita-catalog", "digita-catalog-show"].includes(basename(catalog))) return [];
  const bike = relative(join(catalog, ".."), join(catalogAppDir(catalog, "workshop"), "operations/entities/bike.entity.json"));
  return ["motor_brand", "battery_wh"].map((field) => ({
    where: `${bike}: Bike.${field}.depends_on`,
    expression: "doc.is_ebike == true",
    doc: { is_ebike: 1 },
    form: { value: false },
    engine: { value: true },
    now: { value: true },
  }));
}

describe.each(CATALOGS)("the expressions of %s", (catalog) => {
  const present = existsSync(catalog);
  const expressions = present ? catalogExpressions(catalog) : [];

  it.skipIf(!present)("has field expressions to judge", () => {
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
