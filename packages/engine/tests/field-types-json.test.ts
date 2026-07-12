import { describe, it, expect } from "vitest";
import type { FieldDefinition } from "@digitaplatform/shared";
import { getFieldTypeHandler, FieldValueError } from "../src/core/entity/field-types.js";

/**
 * Regression: a malformed JSON string used to throw a raw SyntaxError out of
 * jsonHandler.toStorage — which runs BEFORE Zod validation in serializeFields —
 * escaping as an unhandled HTTP 500. It must now throw a typed FieldValueError
 * (rewrapped into a ValidationFailedError → HTTP 400) with the i18n key.
 */
describe("JSON field toStorage — malformed input is a typed field error, not a 500", () => {
  const field = {
    fieldname: "payload",
    label: "Payload",
    fieldtype: "JSON",
  } as unknown as FieldDefinition;

  const handler = getFieldTypeHandler("JSON");

  it("throws a FieldValueError (not a bare SyntaxError) on a malformed JSON string", () => {
    let thrown: unknown;
    try {
      handler.toStorage("{ not valid", field);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(FieldValueError);
    expect((thrown as FieldValueError).field).toBe("payload");
    expect((thrown as FieldValueError).message_key).toBe("field_invalid_json");
  });

  it("still parses valid JSON strings and passes objects through unchanged", () => {
    expect(handler.toStorage('{"a":1}', field)).toEqual({ a: 1 });
    const obj = { a: 1 };
    expect(handler.toStorage(obj, field)).toBe(obj);
    expect(handler.toStorage(null, field)).toBeNull();
    expect(handler.toStorage(undefined, field)).toBeNull();
  });
});
