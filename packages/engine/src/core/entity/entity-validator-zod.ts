import type { EntityDefinition } from "@digitaplatform/shared";
import type { ValidationError, ValidationResult } from "./types.js";
import { ZodSchemaBuilder } from "./zod-schema-builder.js";
import { validateRowUniqueness } from "./row-uniqueness-validator.js";

/**
 * Zod-driven runtime validation. Runs the per-entity Zod schema (shape +
 * field-level constraints) against the data, then layers the
 * row-uniqueness check on top. Replaces the hand-rolled `validateEntityData`
 * for shape and field-level constraints — link existence is enforced
 * separately by `LinkValidator`.
 *
 * Issue paths: Zod's `.path` arrays are mapped to dotted strings; for Table
 * rows the path becomes `lines[2].product` to match the legacy validator's
 * shape (and existing UI translation keys).
 *
 * The entity validator-zod is stateful only via its singleton schema builder,
 * which caches per-entity. Pass a builder for explicit control in tests.
 */
export function validateEntityDataZod(
  entity: EntityDefinition,
  data: Record<string, unknown>,
  builder: ZodSchemaBuilder,
  isNew: boolean = true,
): ValidationResult {
  const errors: ValidationError[] = [];

  const schema = builder.get(entity);
  const result = schema.safeParse(data);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const fieldPath = pathToString(issue.path);
      // The "required" message key comes from Zod's own "Required" / undefined
      // detection; map to the platform's `field_required` for parity.
      const messageKey = mapZodIssue(issue.code, issue.message);
      errors.push({
        field: fieldPath,
        message_key: messageKey,
        message: issue.message,
        params: { field: fieldPath },
      });
    }
  }

  // Domain checks layered on top of Zod's shape validation.
  // Row-uniqueness: compound-key constraints across Table rows.
  errors.push(...validateRowUniqueness(entity, data));

  return {
    valid: errors.length === 0,
    errors,
  };
}

function pathToString(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "";
  let out = "";
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (typeof seg === "number") out += `[${seg}]`;
    else if (typeof seg === "symbol") out += `[${seg.description ?? "symbol"}]`;
    else out += i === 0 ? seg : `.${seg}`;
  }
  return out;
}

function mapZodIssue(code: string, message: string): string {
  // Custom refinements carry their own message key (e.g. the per-row
  // mandatory_depends_on check) — preserve it instead of flattening to a generic.
  if (message === "field_mandatory_depends_on") return message;
  switch (code) {
    case "invalid_type":
      // Zod uses invalid_type for missing required fields too — distinguish
      // here is awkward without inspecting the issue further. Use the most
      // common platform key; downstream UI already handles both.
      return "field_required";
    case "too_small":
      return "field_min_length";
    case "too_big":
      return "field_max_length";
    case "invalid_string":
      return "field_invalid_regex";
    case "invalid_enum_value":
      return "field_invalid_select";
    default:
      return "field_invalid_type";
  }
}
