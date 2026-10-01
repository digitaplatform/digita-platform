import { describe, it, expectTypeOf } from "vitest";
import type { FieldDefinition } from "@digitaplatform/shared";

/**
 * Link search matches the target's search_fields, so an author who set target_search on a Link
 * changed no search. A field offers no such key, and the type check holds a definition to that.
 */
describe("a field definition", () => {
  it("offers no search keys, because no search reads them from a field", () => {
    expectTypeOf<FieldDefinition>().not.toHaveProperty("target_search");
  });
});
