/**
 * Expand a field's magic-token `default` to a concrete value on the client, so a
 * newly-created row/doc carries the real value instead of the literal token.
 *
 * Mirrors the engine's resolveMagicDefault (core/defaults/default-resolver.ts).
 * Without this, a child-table field defaulting to `__today__` seeded a row with
 * the literal string "__today__" — which the server then rejects for a Date field
 * (Zod) or silently persists as a wrong Data value (H-P5, UI half).
 */
export function resolveDefaultToken(
  raw: unknown,
  user?: { email?: string; full_name?: string } | null,
): unknown {
  if (typeof raw !== 'string') return raw;
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
