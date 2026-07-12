import { z, type ZodTypeAny } from "zod";
import type { EntityDefinition, FieldDefinition, FieldType } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES, ROW_ID_FIELD } from "@digitaplatform/shared";
import { isValidColor } from "../validation/validators/color.js";
import { evaluateExpression } from "../expression/expression-evaluator.js";

/**
 * Build a Zod schema from an `EntityDefinition` for runtime data
 * validation. Validates required, length, regex, range, enum options,
 * date parseability, JSON shape, plus child Tables (recursive with
 * min_rows/max_rows + child fields). Cross-doc concerns
 * (row-uniqueness, link existence) live in `entity-validator.ts` and
 * `LinkValidator`.
 */
export function buildEntitySchema(entity: EntityDefinition): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of entity.fields) {
    if (LAYOUT_FIELD_TYPES.includes(field.fieldtype)) continue;
    if (!isStoredFieldType(field.fieldtype)) continue;
    shape[field.fieldname] = buildFieldSchema(field);
  }
  // The entity layer also carries `_id`, `docstatus`, `owner`, `creation`,
  // `modified`, etc. Don't validate those here — they're stamped by the
  // engine, not user input. `passthrough()` so we don't drop them on parse.
  const obj = z.object(shape).loose();

  // Server-side conditional-required for TOP-LEVEL fields (was only enforced for
  // child-table rows + the client). Mirrors the tableSchema block below: when a
  // field's mandatory_depends_on condition holds against the whole doc, the field
  // must be non-empty — so a non-browser write can't omit a conditionally-required
  // field.
  const conditionalFields = entity.fields.filter(
    (f) => f.mandatory_depends_on && !LAYOUT_FIELD_TYPES.includes(f.fieldtype) && isStoredFieldType(f.fieldtype),
  );
  if (conditionalFields.length === 0) return obj;
  return obj.superRefine((data, ctx) => {
    const d = data as Record<string, unknown>;
    for (const f of conditionalFields) {
      if (!evaluateExpression(f.mandatory_depends_on!, { doc: d })) continue;
      const v = d[f.fieldname];
      const empty = v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) {
        ctx.addIssue({ code: "custom", path: [f.fieldname], message: "field_mandatory_depends_on" });
      }
    }
  });
}

export function buildFieldSchema(field: FieldDefinition): ZodTypeAny {
  let s = baseSchemaForType(field);

  // Apply field-level constraints. Each helper is a no-op if the constraint
  // doesn't apply to the underlying type.
  s = applyStringConstraints(s, field);
  s = applyNumberConstraints(s, field);
  s = applyNumericEmptyGuard(s, field);

  // Required ⇄ optional. Empty string treated as missing for compatibility
  // with the previous validator (Data fields treat "" as empty).
  if (!field.required) {
    s = s.nullable().optional();
  }

  return s;
}

function baseSchemaForType(field: FieldDefinition): ZodTypeAny {
  switch (field.fieldtype) {
    case "Data":
    case "Phone":
    case "Barcode":
    case "Signature":
      return dataLikeSchema(field);
    case "Attach":
    case "AttachImage":
    case "Image":
      // These hold a URL/storage-key that later renders directly into href/src.
      // Reject dangerous schemes at write time (the engine-Zod half of the stored-
      // XSS fix; the UI also neutralizes at render). Only schemeless (relative)
      // values, http(s), and inline data:image are allowed.
      return dataLikeSchema(field).refine(
        (v) => typeof v !== "string" || isSafeAttachValue(v),
        "field_unsafe_url",
      );
    case "Code":
    case "Markdown":
    case "Text":
    case "SmallText":
    case "TextEditor":
      return z.string();
    case "Password":
      return z.string();
    case "Color":
      // Single source of truth for the hex rule: validators/color.ts
      return z.string().refine(isValidColor, "field_invalid_color");
    case "Int":
      return z.coerce.number().int();
    case "Float":
    case "Currency":
    case "Percent":
      return z.coerce.number();
    case "Rating":
      return z.coerce.number().min(0).max(1);
    case "Check":
      // Accept boolean OR 0/1 (matches the existing handler's tolerance).
      return z.union([z.boolean(), z.literal(0), z.literal(1)]);
    case "Date":
      // A calendar day — canonical storage form is "YYYY-MM-DD". Enforce it so a
      // stray non-canonical string can't later mis-compare in a date filter (a Date
      // object is accepted for hook writers and canonicalized at the storage layer).
      return z.union([z.string(), z.date()]).refine(
        (v) => {
          if (v instanceof Date) return !isNaN(v.getTime());
          if (typeof v !== "string") return false;
          return v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime()));
        },
        { message: "field_invalid_date" },
      );
    case "Datetime":
      // A timestamp — stored as a BSON Date; any parseable date string / Date is fine.
      return z.union([z.string(), z.date()]).refine(
        (v) => {
          if (v instanceof Date) return !isNaN(v.getTime());
          if (typeof v !== "string" || !v) return v === "";
          return !isNaN(new Date(v).getTime());
        },
        { message: "field_invalid_date" },
      );
    case "Time":
      // Time is a wall-clock value (HH:mm[:ss]), NOT a Date — `new Date("14:30")`
      // is Invalid Date, so it must have its own branch or every canonical time
      // is rejected on the happy path.
      return z.string().refine((v) => v === "" || /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v), {
        message: "field_invalid_time",
      });
    case "Duration":
      // Non-negative integer count of seconds — no free strings (was silently
      // truncated/NaN'd). Child-table Duration cells bypass serializeFields, so
      // gate them here too.
      return z.coerce.number().int().min(0);
    case "Select":
      if (Array.isArray(field.options) && field.options.length > 0) {
        return z.enum(field.options as [string, ...string[]]);
      }
      return z.string();
    case "Link":
      return z.string();
    case "Tag":
      return z.array(z.string());
    case "JSON":
      return z.any();
    case "Geolocation":
      return z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
      });
    case "Table":
      return tableSchema(field);
    case "ReadOnly":
      return z.any();
    default:
      return z.any();
  }
}

/**
 * Attach/AttachImage/Image values are rendered into href/src, so a stored
 * `javascript:` (or `data:text/html`) URL executes in a later viewer's session.
 * Allow only schemeless (relative path / storage key), http(s), and data:image.
 * A "scheme" needs ≥2 chars before the colon so a bare Windows path (`c:\…`) or a
 * key with a colon is treated as relative, not a URL scheme.
 */
function isSafeAttachValue(v: string): boolean {
  const t = v.trim();
  if (t === "") return true;
  if (!/^[a-z][a-z0-9+.-]+:/i.test(t)) return true; // no URL scheme → relative
  const lower = t.toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("data:image/")
  );
}

function dataLikeSchema(field: FieldDefinition): ZodTypeAny {
  let s: z.ZodString = z.string();
  // Built-in formats via Data.options as a string (e.g. "Email", "URL").
  if (typeof field.options === "string") {
    switch (field.options) {
      case "Email":
        return z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "field_invalid_email");
      case "URL":
        return z.url("field_invalid_url");
      case "Phone":
        return z.string().regex(/^\+?[\d\s\-()]{7,20}$/, "field_invalid_phone");
      case "IP":
        return z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$|:/, "field_invalid_ip");
    }
  }
  return s;
}

function applyStringConstraints(schema: ZodTypeAny, field: FieldDefinition): ZodTypeAny {
  if (!isStringSchema(schema)) return schema;
  let s = schema as z.ZodString;
  if (field.max_length) s = s.max(field.max_length, "field_max_length");
  if (field.min_length) s = s.min(field.min_length, "field_min_length");
  if (field.regex) {
    try {
      s = s.regex(new RegExp(field.regex), field.regex_message ?? "field_invalid_regex");
    } catch {
      // bad regex in entity JSON — surfaces at boot via the loader;
      // here we degrade silently rather than blowing up parse() at runtime.
    }
  }
  return s;
}

function applyNumberConstraints(schema: ZodTypeAny, field: FieldDefinition): ZodTypeAny {
  if (!isNumberSchema(schema)) return schema;
  let s = schema as z.ZodNumber;
  if (field.min_value !== undefined) s = s.min(field.min_value, "field_min_value");
  if (field.max_value !== undefined) s = s.max(field.max_value, "field_max_value");
  if (field.non_negative) s = s.min(0, "field_non_negative");
  return s;
}

const NUMERIC_COERCE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "Int",
  "Float",
  "Currency",
  "Percent",
  "Rating",
]);

/**
 * Guard coercing-numeric fields against empty-ish inputs. Plain `z.coerce.number()`
 * turns '', whitespace, [], null and false into 0 — silently bypassing `required`
 * and `non_negative`. Wrap the (already range-constrained) number schema in a
 * preprocess that maps those to NaN so the inner number schema rejects them;
 * genuine numbers and numeric strings ("42") pass through unchanged. Runs BEFORE
 * the outer `.nullable().optional()` so an OPTIONAL field's null/undefined still
 * short-circuits.
 */
function applyNumericEmptyGuard(schema: ZodTypeAny, field: FieldDefinition): ZodTypeAny {
  if (!NUMERIC_COERCE_TYPES.has(field.fieldtype)) return schema;
  return z.preprocess((v) => {
    if (v === null || typeof v === "boolean" || Array.isArray(v)) return NaN;
    if (typeof v === "string" && v.trim() === "") return NaN;
    return v;
  }, schema);
}

function tableSchema(field: FieldDefinition): ZodTypeAny {
  const childShape: Record<string, ZodTypeAny> = {
    [ROW_ID_FIELD]: z.string().optional(),
    idx: z.number().int().optional(),
  };
  for (const cf of field.child_fields ?? []) {
    if (LAYOUT_FIELD_TYPES.includes(cf.fieldtype)) continue;
    if (!isStoredFieldType(cf.fieldtype)) continue;
    childShape[cf.fieldname] = buildFieldSchema(cf);
  }

  const rowObject = z.object(childShape).loose();

  // Per-row conditional-required (mandatory_depends_on) — enforced server-side so
  // a client bypass can't persist an incomplete row. The condition is evaluated
  // with the ROW as `doc` scope (row-local), mirroring the client's per-row sweep.
  // A field declared statically `required` is already handled by buildFieldSchema;
  // this covers the case where a cell is mandatory only when its rule matches.
  const conditionalFields = (field.child_fields ?? []).filter((cf) => cf.mandatory_depends_on);
  const rowSchema: ZodTypeAny =
    conditionalFields.length === 0
      ? rowObject
      : rowObject.superRefine((row, ctx) => {
          const r = row as Record<string, unknown>;
          for (const cf of conditionalFields) {
            if (!evaluateExpression(cf.mandatory_depends_on!, { doc: r })) continue;
            const v = r[cf.fieldname];
            const empty =
              v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
            if (empty) {
              // "custom" string literal (not the deprecated z.ZodIssueCode enum).
              ctx.addIssue({
                code: "custom",
                path: [cf.fieldname],
                message: "field_mandatory_depends_on",
              });
            }
          }
        });

  let arr: z.ZodArray<ZodTypeAny> = z.array(rowSchema);
  if (field.min_rows !== undefined) {
    arr = arr.min(field.min_rows, "table_min_rows");
  }
  if (field.max_rows !== undefined) {
    arr = arr.max(field.max_rows, "table_max_rows");
  }
  return arr;
}

function isStoredFieldType(t: FieldType): boolean {
  // A5: ReadOnly IS stored (matches field-types.isStoredFieldType) — it's now
  // included in the validation shape (permissive z.any()) instead of being
  // dropped, so serialization and validation agree and a persisted ReadOnly value
  // (computed / fetch_from display) is validated rather than silently skipped.
  return !LAYOUT_FIELD_TYPES.includes(t);
}

function isStringSchema(s: ZodTypeAny): boolean {
  return s._def?.type === "string" || s.constructor?.name === "ZodString";
}

function isNumberSchema(s: ZodTypeAny): boolean {
  return s._def?.type === "number" || s.constructor?.name === "ZodNumber";
}
