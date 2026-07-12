import type { DelegationScope } from "@digitaplatform/shared";
import type { UserContext } from "../permissions/types.js";

/**
 * What the engine learns from a verified access token. The token's wire
 * shape (JWKS-verified RS256, minted by digita-auth) never leaks past this
 * boundary.
 */
export interface VerifiedIdentity {
  user: UserContext;
  language?: string;
}

/**
 * A verified on-behalf DELEGATION token (jobs/satellite path). Same verified
 * principal as an access token (roles re-scoped, tiers normalized) PLUS the
 * bound {@link DelegationScope} the caller may exercise and the forensic
 * actor/jti. The service path enforces `scope` against the actual request.
 */
export interface VerifiedDelegation {
  user: UserContext;
  scope: DelegationScope;
  /** Declaring satellite (audit) — e.g. "digita-jobs". */
  actor: string;
  /** The delegation grant/run jti (audit trail). */
  jti: string;
}

/**
 * Engine-side authentication boundary. The engine is a token VERIFIER: it
 * verifies access tokens minted by digita-auth (offline, via cached JWKS)
 * and never issues them — login / refresh / logout / 2FA / sessions all
 * live in digita-auth. The middleware and route handlers depend on this
 * port, so the verification backend can change without touching them.
 */
export interface AuthnPort {
  verifyAccessToken(token: string): Promise<VerifiedIdentity>;
  /**
   * Verify an on-behalf delegation token (TOKEN_TYPE.DELEGATION) via the same
   * JWKS. Gates the `typ`, re-scopes roles to this engine's app, normalizes
   * tiers, and returns the bound scope + actor/jti. Throws on any other token
   * type or an invalid signature/iss/aud.
   */
  verifyDelegationToken(token: string): Promise<VerifiedDelegation>;
}
