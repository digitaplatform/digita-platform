import type { EntityDefinition } from "@digitaplatform/shared";
import type { Document } from "mongodb";
import type { FilterTuple } from "./filter-builder.js";
import { FieldValueError } from "../entity/field-types.js";

/**
 * Type-aware coercion of filter VALUES to each field's storage form.
 *
 * A relative date filter (`$now ± duration`) resolves to a JS Date object, and a
 * `Date` field is stored as a "YYYY-MM-DD" STRING — MongoDB never compares a String
 * against a Date, so the `$match` silently returns 0 rows. The mirror bug: a STRING
 * filter against a `Datetime` field (stored as a BSON Date) also 0-matches. This
 * coerces the filter value to the field's storage form so the comparison works —
 * purely field-type-metadata driven (no entity/app knowledge), so it stays generic.
 *
 * Only equality/range/`in`/`between` operators (where the value is a date scalar or
 * array) are touched; text/set/presence operators (`like`, `is`, `exists`, `regex`)
 * are left untouched. An uncoercible value fails LOUD (FieldValueError → 400), never
 * a silent 0-row match.
 */

/** Operators whose value is a single date scalar in a comparison. */
const SCALAR_OPS = new Set(["=", "==", "!=", "<>", "<", "<=", ">", ">="]);
/** Operators whose value is an array of date scalars (coerce element-wise). */
const ARRAY_OPS = new Set(["in", "not in", "between"]);
/** Meta fields stored as BSON Date (Datetime-like) but absent from entity.fields. */
const META_DATETIME_FIELDS = new Set(["creation", "modified"]);

/** Resolve a filter field path (possibly `table.child`) to its declared fieldtype,
 *  or undefined when it can't be resolved (→ value left untouched). */
function resolveFieldType(entity: EntityDefinition, path: string): string | undefined {
  if (META_DATETIME_FIELDS.has(path)) return "Datetime";
  const dot = path.indexOf(".");
  if (dot === -1) {
    return entity.fields.find((f) => f.fieldname === path)?.fieldtype;
  }
  const root = entity.fields.find((f) => f.fieldname === path.slice(0, dot));
  if (root?.fieldtype !== "Table") return undefined;
  const childName = path.slice(dot + 1);
  return root.child_fields?.find((f) => f.fieldname === childName)?.fieldtype;
}

/** Coerce ONE value to the date field's storage form. Date field → canonical
 *  "YYYY-MM-DD" string; Datetime/creation/modified → BSON Date. Fail LOUD on an
 *  uncoercible non-empty value. `null`/`undefined`/`""` pass through untouched
 *  (presence semantics, not a date comparison). */
function coerceScalar(fieldtype: string, field: string, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  if (fieldtype === "Date") {
    // Stored form is a "YYYY-MM-DD" string. A Date object (from $now ± duration)
    // becomes its UTC calendar day — the platform's existing convention (__today__).
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return value; // already a string → compares string-vs-string (ISO sorts correctly)
  }
  // Datetime-like: stored as BSON Date. A string must become a Date, else
  // "string ⋛ Date" silently matches nothing.
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      throw new FieldValueError(field, "field_invalid_date", { value });
    }
    return d;
  }
  return value; // number/boolean etc. — not a date filter, leave alone
}

/**
 * Return a copy of `filters` with date/datetime field values coerced to storage
 * form. Non-date fields, unresolvable paths, and text/set/presence operators are
 * returned untouched. Undefined/empty input passes through.
 */
export function coerceDateFilterValues(
  entity: EntityDefinition,
  filters?: FilterTuple[],
): FilterTuple[] | undefined {
  if (!filters || filters.length === 0) return filters;
  return filters.map(([field, op, value]): FilterTuple => {
    const ft = resolveFieldType(entity, field);
    if (ft !== "Date" && ft !== "Datetime") return [field, op, value];
    if (SCALAR_OPS.has(op)) return [field, op, coerceScalar(ft, field, value)];
    if (ARRAY_OPS.has(op) && Array.isArray(value)) {
      return [field, op, value.map((v) => coerceScalar(ft, field, v))];
    }
    return [field, op, value];
  });
}

/** Mongo comparison operators inside a `$match` whose operand is a date scalar. */
const MATCH_SCALAR_OPS = new Set(["$eq", "$ne", "$gt", "$gte", "$lt", "$lte"]);
/** Mongo comparison operators whose operand is an array of date scalars. */
const MATCH_ARRAY_OPS = new Set(["$in", "$nin"]);

/** Coerce the operand(s) of ONE `$match` field predicate (scalar, or an operator
 *  object like `{ $gte: <Date>, $lte: <Date> }`, or `{ $in: [...] }`). */
function coerceMatchOperand(ft: string, field: string, pred: unknown): unknown {
  if (pred === null || pred instanceof Date || typeof pred !== "object") {
    return coerceScalar(ft, field, pred);
  }
  if (Array.isArray(pred)) return pred.map((v) => coerceScalar(ft, field, v));
  const out: Record<string, unknown> = { ...(pred as Record<string, unknown>) };
  for (const [op, val] of Object.entries(pred as Record<string, unknown>)) {
    if (MATCH_SCALAR_OPS.has(op)) out[op] = coerceScalar(ft, field, val);
    else if (MATCH_ARRAY_OPS.has(op) && Array.isArray(val)) out[op] = val.map((v) => coerceScalar(ft, field, v));
    // $regex/$exists/$size/… left untouched
  }
  return out;
}

/**
 * Coerce date/datetime operands inside a `$match` stage document (aggregate pipelines),
 * resolving each field key against `entity`. Descends `$and`/`$or`/`$nor`; leaves
 * `$expr` and other `$`-keys untouched. Same storage-form coercion + fail-loud
 * semantics as the tuple filter path. NOTE: caller must only pass TOP-LEVEL `$match`
 * stages before the first reshape/join — after a `$lookup`/`$group`/etc. the field
 * names/entity context change and this must not run.
 */
export function coerceMatchDates(entity: EntityDefinition, match: Document): Document {
  const out: Document = {};
  for (const [key, val] of Object.entries(match)) {
    if (key === "$and" || key === "$or" || key === "$nor") {
      out[key] = Array.isArray(val) ? (val as Document[]).map((m) => coerceMatchDates(entity, m)) : val;
    } else if (key.startsWith("$")) {
      out[key] = val; // $expr / $text / … — not a field predicate
    } else {
      const ft = resolveFieldType(entity, key);
      out[key] = ft === "Date" || ft === "Datetime" ? coerceMatchOperand(ft, key, val) : val;
    }
  }
  return out;
}
