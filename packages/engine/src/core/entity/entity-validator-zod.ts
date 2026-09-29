import type { EntityDefinition } from "@digitaplatform/shared";
import type { z } from "zod";
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
 * Message keys: every rule `field-to-zod.ts` builds names its key as its Zod
 * message, and that key is the issue's `message_key`. A Zod check that names
 * none, such as a value of the wrong type, gets `field_invalid_type` through the
 * parse's error map, which ranks below a message the schema names.
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
  const result = schema.safeParse(data, { error: () => "field_invalid_type", reportInput: true });

  if (!result.success) {
    for (const issue of result.error.issues) {
      const fieldPath = pathToString(issue.path);
      errors.push({
        field: fieldPath,
        message_key: issue.message,
        message: issue.message,
        params: issueParams(fieldPath, issue),
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

/** The bound a length, range or row-count text names, or the option a Select refused. */
function issueParams(fieldPath: string, issue: z.core.$ZodIssue): Record<string, string> {
  const params: Record<string, string> = { field: fieldPath };
  if (issue.code === "too_small") params.min = String(issue.minimum);
  if (issue.code === "too_big") params.max = String(issue.maximum);
  if (issue.code === "invalid_value") params.value = String(issue.input);
  return params;
}
