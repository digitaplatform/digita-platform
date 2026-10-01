import { describe, it, expectTypeOf } from "vitest";
import type { FieldDefinition } from "@digitaplatform/shared";

/**
 * A printout comes from a digita-report definition, which never reads the fields of an entity,
 * so an author who set print_hide or print_width on a field shaped no printout. A field offers
 * neither key, and the type check holds a definition to that.
 */
describe("a field definition", () => {
  it("offers no print keys, because printing never reads a field", () => {
    expectTypeOf<FieldDefinition>().not.toHaveProperty("print_hide");
    expectTypeOf<FieldDefinition>().not.toHaveProperty("print_width");
  });
});
