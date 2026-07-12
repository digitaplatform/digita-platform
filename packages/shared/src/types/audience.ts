/**
 * Audience / tier model (ADR-A1…A5). The platform has three tiers:
 *  - `anonymous`: the public, unauthenticated surface — open to everyone.
 *  - `external`:  logged-in external users (a partner portal / storefront).
 *  - `internal`:  logged-in operators (the back office).
 *
 * Identity carries an AUDIENCE-SET — which authenticated worlds a user may enter —
 * signed by digita-auth as a LIST claim (NOT a scalar, NOT derived from a role). A user
 * may hold BOTH internal and external (three accesses, one account). Roles stay orthogonal
 * (what you may do). The audience label is presentation-scoping only; RBAC + the P-SEC
 * hardening remain the data-security boundary.
 */

/** The three tiers a surface (app/site) can belong to. */
export type Audience = "anonymous" | "external" | "internal";

/** The authenticated tiers a user account can be granted (anonymous is universal, so it is
 *  never a grant). A user's audience-set is `AudienceGrant[]`. */
export type AudienceGrant = "internal" | "external";

/** JWT claim carrying the user's audience-set. Deliberately NOT `aud` (reserved in JWT). */
export const AUDIENCE_CLAIM = "tiers" as const;

// NOTE (no-fallback policy): there is deliberately NO DEFAULT_AUDIENCE constant.
// An account without an assigned tier does not silently default to anything —
// digita-auth REFUSES to issue a token (audience_not_assigned) and the engine
// treats a claimless token as NOT internal (fail-closed). The absence is surfaced
// loudly and forces an admin to assign a tier, rather than being papered over.

/** Per-app declaration of ONE tier (in `plugins.config.json`'s `audiences` map). The
 *  engine relays this verbatim — only the frontend interprets it. All fields optional so
 *  the whole block is additive and old configs keep working. */
export interface AudienceConfig {
  /** Whether the app exposes this tier at all. */
  enabled: boolean;
  /** How the tier is served: SSR public site (`web`) or the audience-switched SPA (`spa`). */
  runtime?: "web" | "spa";
  /** External entry URL (e.g. the public marketing site for the anonymous tier). */
  entry?: string;
  /** Public site id / per-tier template + post-login home overrides. */
  site_id?: string;
  template?: string;
  home?: string;
}

/** The per-app `audiences` map declared in `plugins.config.json`. Absent ⇒ internal-only
 *  app (today's behaviour), so existing apps are unaffected. */
export type AudienceMap = Partial<Record<Audience, AudienceConfig>>;

/**
 * Entry gate: may a user with `grants` enter a surface whose audience is `target`?
 * Public is open to all; internal/external require the matching grant. Pure + shared so the
 * engine, the shell and tests agree on ONE rule. NOTE: this only gates the presentation
 * shell — data access is always separately enforced by engine RBAC.
 */
export function canEnterAudience(
  target: Audience,
  grants: readonly AudienceGrant[] | undefined,
): boolean {
  if (target === "anonymous") return true;
  return !!grants && grants.includes(target);
}
