import { describe, it, expectTypeOf } from "vitest";
import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";

/**
 * Link search matches the target's search_fields and global search the entity's, so an author who
 * set target_search on a Link or in_global_search on a field changed no search. A field offers
 * neither key, and the type check holds a definition to that. The entity's in_global_search stays:
 * it puts the entity into global search.
 */
describe("a field definition", () => {
  it("offers no search keys, because no search reads them from a field", () => {
    expectTypeOf<FieldDefinition>().not.toHaveProperty("target_search");
    expectTypeOf<FieldDefinition>().not.toHaveProperty("in_global_search");
    expectTypeOf<EntityDefinition>().toHaveProperty("in_global_search");
  });
});
