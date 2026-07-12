/**
 * Validation for `EntityDefinition.storage_path` — the entity-scoped folder
 * every upload key is prefixed with (`<storage_path>/<uuid><ext>`).
 *
 * Allowed shape: one or two lowercase segments of `[a-z0-9_-]`, joined by a
 * single `/`. No leading/trailing slash, no empty segments, no `..`, no
 * uppercase. Examples: `"customers"`, `"products"`, `"module/customers"`.
 *
 * Used in two places with the same rule on purpose:
 *   - EntityRegistry boot lint (fail-fast for misdeclared entities)
 *   - upload-router request validation (defense in depth at runtime)
 */
export const STORAGE_PATH_PATTERN = /^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/;

export function isValidStoragePath(path: string): boolean {
  return STORAGE_PATH_PATTERN.test(path);
}

/** Human-readable rule text reused by boot-lint and 400 responses. */
export const STORAGE_PATH_RULE =
  'lowercase [a-z0-9_-] segments, at most one "/" nesting level, ' +
  'no leading/trailing slash, no ".."';
