import type { ZodTypeAny } from "zod";
import type { EntityDefinition } from "@digitaplatform/shared";
import { buildEntitySchema } from "./field-to-zod.js";

/**
 * Caches one Zod schema per entity definition. The schema is built lazily on
 * first access and reused thereafter — entity definitions don't change at
 * runtime, so the cache is safe for the process lifetime.
 *
 * Reset is exposed only for tests where entity defs are swapped between
 * cases.
 */
export class ZodSchemaBuilder {
  private cache = new Map<string, ZodTypeAny>();

  get(entity: EntityDefinition): ZodTypeAny {
    const cached = this.cache.get(entity.name);
    if (cached) return cached;
    const schema = buildEntitySchema(entity);
    this.cache.set(entity.name, schema);
    return schema;
  }

  invalidate(entityName?: string): void {
    if (entityName) this.cache.delete(entityName);
    else this.cache.clear();
  }
}
