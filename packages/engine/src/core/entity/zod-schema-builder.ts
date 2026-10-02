import type { ZodTypeAny } from "zod";
import type { EntityDefinition } from "@digitaplatform/shared";
import { buildEntitySchema } from "./field-to-zod.js";

/**
 * Caches one Zod schema per entity definition object, built on first use. PUT /meta, the
 * fallback of DELETE /meta and a reload each register a new object, so a changed definition
 * gets its own schema, and an old one goes with its object.
 */
export class ZodSchemaBuilder {
  private cache = new WeakMap<EntityDefinition, ZodTypeAny>();

  get(entity: EntityDefinition): ZodTypeAny {
    const cached = this.cache.get(entity);
    if (cached) return cached;
    const schema = buildEntitySchema(entity);
    this.cache.set(entity, schema);
    return schema;
  }
}
