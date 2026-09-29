import type { FieldDefinition } from '@digitaplatform/shared';

type DefaultUser = { email?: string; full_name?: string } | null;

/**
 * Expand a field's magic-token `default` to a concrete value on the client, so a
 * newly-created row/doc carries the real value instead of the literal token.
 *
 * Mirrors the engine's resolveMagicDefault (core/defaults/default-resolver.ts). The
 * engine fills a default only where the value arrives empty, so a token seeded here
 * as text would be saved as text. An `eval:` default returns `undefined`: it reads
 * the document being saved, so only the engine can evaluate it, on insert.
 */
export function resolveDefaultToken(raw: unknown, user?: DefaultUser): unknown {
  if (typeof raw !== 'string') return raw;
  if (raw.startsWith('eval:')) return undefined;
  switch (raw) {
    case '__today__':
      return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    case '__now__':
      return new Date().toISOString();
    case '__user__':
      return user?.email ?? '';
    case '__username__':
      return user?.full_name ?? user?.email ?? '';
    default:
      return raw;
  }
}

/** The seed of a new record, table row or action dialog: each field's expanded `default`. */
export function buildDefaults(
  fields: readonly Pick<FieldDefinition, 'fieldname' | 'default'>[],
  user?: DefaultUser,
): Record<string, unknown> {
  const seed: Record<string, unknown> = {};
  for (const f of fields) {
    const value = resolveDefaultToken(f.default, user);
    if (value !== undefined) seed[f.fieldname] = value;
  }
  return seed;
}
