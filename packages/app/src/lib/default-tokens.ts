import { calendarDay, type FieldDefinition } from '@digitaplatform/shared';

type DefaultUser = { email?: string; full_name?: string } | null;

/**
 * Expand a field's magic-token `default` to a concrete value on the client, so a
 * newly-created row/doc carries the real value instead of the literal token.
 *
 * Mirrors the engine's resolveMagicDefault (core/defaults/default-resolver.ts). The
 * engine fills a default only where the value is missing or "", so a token seeded here
 * as text would be saved as text. An `eval:` default returns `undefined`.
 */
export function resolveDefaultToken(raw: unknown, user: DefaultUser, timeZone: string): unknown {
  if (typeof raw !== 'string') return raw;
  if (isEvalDefault(raw)) return undefined;
  switch (raw) {
    case '__today__':
      return calendarDay(new Date(), timeZone); // YYYY-MM-DD of the tenant's day
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

/** The tenant's time zone from /boot's settings. Before /boot answers no form is drawn; "UTC" is
 *  Setting.timezone's declared default. */
export function tenantTimeZoneOf(settings: { timezone?: string } | null | undefined): string {
  return settings?.timezone ?? 'UTC';
}

/** Whether the form seeds a value from this `default`: every default but none and an `eval:`. */
export function seedsDefault(raw: unknown): boolean {
  return raw !== undefined && !isEvalDefault(raw);
}

/** An `eval:` default reads the document being saved, so only the engine can evaluate it, on insert. */
export function isEvalDefault(raw: unknown): boolean {
  return typeof raw === 'string' && raw.startsWith('eval:');
}

/** The seed of a new record, table row or action dialog: each field's expanded `default`. */
export function buildDefaults(
  fields: readonly Pick<FieldDefinition, 'fieldname' | 'default'>[],
  user: DefaultUser,
  timeZone: string,
): Record<string, unknown> {
  const seed: Record<string, unknown> = {};
  for (const f of fields) {
    const value = resolveDefaultToken(f.default, user, timeZone);
    if (value !== undefined) seed[f.fieldname] = value;
  }
  return seed;
}
