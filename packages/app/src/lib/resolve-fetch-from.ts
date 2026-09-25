import type { EntityDefinition } from '@digitaplatform/shared';

/** Top-level fields whose `fetch_from` reads from `changedField.<path>`. */
export function resolveFetchFromTargets(
  meta: EntityDefinition,
  changedField: string,
): Array<{ target: string; sourcePath: string }> {
  const prefix = `${changedField}.`;
  const out: Array<{ target: string; sourcePath: string }> = [];
  for (const f of meta.fields) {
    if (typeof f.fetch_from === 'string' && f.fetch_from.startsWith(prefix)) {
      out.push({ target: f.fieldname, sourcePath: f.fetch_from.slice(prefix.length) });
    }
  }
  return out;
}
