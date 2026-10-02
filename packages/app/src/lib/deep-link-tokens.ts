import { calendarDay } from '@digitaplatform/shared';

/** Resolve a dashboard deep link's unanchored tokens client-side: `$user.<key>` from the session
 *  user, `$now` as the tenant's day, as the engine resolves `$now` on a Date field. An unresolved
 *  `$token` → dev error + null (drop the nav rather than route to junk). */
export function resolveDeepLinkTokens(
  to: string,
  user: Record<string, unknown> | null,
  timeZone: string,
  now: Date = new Date(),
): string | null {
  const out = to
    .replace(/\$user\.(\w+)/g, (_, k: string) => String(user?.[k] ?? ''))
    // The day only where a link names $now: a zone no runtime knows then fails that link alone.
    .replace(/\$now/g, () => calendarDay(now, timeZone));
  if (out.includes('$')) {
    if (import.meta.env.DEV) console.error('[dashboard] unresolved deep-link token:', to);
    return null;
  }
  return out;
}
