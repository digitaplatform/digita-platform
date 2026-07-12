import type { UserContext } from "../permissions/types.js";

/**
 * Engine-side audience helper (ADR-A1…A3, P-SEC).
 *
 * The audience label is presentation-scoping, but it also drives two hardening
 * decisions once untrusted external users share the `authenticate` scope:
 *  - which callers may see internal-only surfaces (full schema, /openapi.json);
 *  - which callers have operator-identity fields stripped from reads.
 */

/** Operator-identity fields stripped from reads for non-internal audiences —
 *  mirrors public-router's PUBLIC_OMIT (an external portal must not expose the
 *  editing operator's login id / who last changed a row). */
const INTERNAL_ONLY_FIELDS = ["owner", "modified_by"] as const;

/**
 * Whether the caller belongs to the internal (back-office) audience.
 *
 * Reads the token's normalized `tiers` audience-set (ADR-A1; never derived from a
 * role, ADR-A2). FAIL-CLOSED (no fallback): a token that carries no valid `tiers`
 * claim is NOT internal — digita-auth refuses to issue a token without an assigned
 * tier, so a claimless token is either a foreign/malformed token or a pre-cutover
 * token in its short remaining window; either way it must not be trusted as an
 * operator. Anonymous / Guest is never internal. A service (on-behalf) principal
 * is internal ONLY when its delegation token carried an `internal` tier — the
 * former unconditional `via_service` bypass was DELETED at the Phase-2 cutover
 * so internal is derived solely from the token's tiers claim (fail-closed).
 */
export function callerIsInternal(user: UserContext | undefined): boolean {
  if (!user || user._id === "Guest") return false;
  return Array.isArray(user.tiers) && user.tiers.includes("internal");
}

/** Delete operator-identity fields from a read row in place (returns it too). */
export function stripInternalFields<T extends Record<string, unknown>>(row: T): T {
  for (const k of INTERNAL_ONLY_FIELDS) delete row[k];
  return row;
}
