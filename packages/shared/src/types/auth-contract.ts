/**
 * Cross-service authentication contract for the digita suite.
 *
 * This file is the single source of truth for the token shapes and the
 * authentication HTTP API exchanged between the services:
 *
 *   digita-auth  — the Identity Provider. SIGNS tokens (private key).
 *                  Owns credentials, sessions, 2FA, the `User` entity,
 *                  the `identity` database, and the login/refresh flows.
 *   digita-core  — VERIFIES tokens (public key, offline via cached JWKS).
 *                  Owns authorization (RBAC, perm_level, scope, if_owner,
 *                  state-strip) and reads `UserContext` from the claims.
 *   digita-post  — VERIFIES tokens the same way (messaging service).
 *
 * Design decisions baked into this contract (deliberate departures from the
 * pre-split monolith, which used HS256 + a shared secret and carried no
 * iss/aud):
 *
 *   - Asymmetric signing (RS256 or EdDSA). Consumers verify with the public
 *     key published at {@link WELL_KNOWN_JWKS_PATH} and CANNOT forge tokens.
 *   - `kid` in the JWT header enables key rotation without downtime.
 *   - `iss` and `aud` are mandatory and MUST be validated by every consumer.
 *   - Pending (two-step 2FA) tokens are single-use; the jti is tracked
 *     server-side by digita-auth and burned on first successful exchange.
 *
 * Nothing here is an implementation — it is a contract. Both sides build
 * against these types so neither drifts.
 */

import type { AudienceGrant } from "./audience.js";

// ─── Token kinds ─────────────────────────────────────────

export const TOKEN_TYPE = {
  /** Short-lived bearer token sent on every API request. */
  ACCESS: "access",
  /** Long-lived rotation token; carries jti + family for replay detection. */
  REFRESH: "refresh",
  /** Short-lived token issued after password step when 2FA is required. */
  PENDING: "pending",
  /**
   * On-behalf delegation token (jobs / satellite → target service). Minted by
   * digita-auth from the delegating user's LIVE session, carries the user's
   * CURRENT roles/tiers read fresh from the user record, and NARROWS them to a
   * single `scope` (service + entity + doc + action). NEVER a valid bearer —
   * every access-token verifier rejects it via the `typ` gate. Honored ONLY on
   * a target service's trusted-service path, and only ALONGSIDE the service key
   * (two factors: key = "a satellite is calling", token = "user X delegated
   * exactly this"). See {@link DelegationTokenClaims}.
   */
  DELEGATION: "delegation",
} as const;

export type TokenType = (typeof TOKEN_TYPE)[keyof typeof TOKEN_TYPE];

/** Signing algorithms digita-auth is allowed to use. Consumers MUST pin to
 *  this allow-list when verifying (never accept `alg: none` or HS*). */
export type JwtAlgorithm = "RS256" | "EdDSA";

/** Path, relative to the digita-auth base URL, that serves the public JWKS.
 *  Consumers fetch + cache this to verify tokens offline. */
export const WELL_KNOWN_JWKS_PATH = "/.well-known/jwks.json";

// ─── Claims ──────────────────────────────────────────────

/** Claims present on every digita token regardless of type. */
export interface BaseTokenClaims {
  /** Issuer — the digita-auth instance. Consumers MUST validate. */
  iss: string;
  /** Audience — the digita suite / tenant. Consumers MUST validate. */
  aud: string;
  /** Subject — the user's stable id (the `User._id`). */
  sub: string;
  /** Token kind discriminator. */
  typ: TokenType;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

/**
 * Access-token payload. This is the authoritative shape from which
 * digita-core builds its `UserContext`. `roles` carries role MEMBERSHIP
 * only — the role DEFINITIONS and what each role may do live in digita-core
 * (authorization is never delegated to the token).
 */
export interface AccessTokenClaims extends BaseTokenClaims {
  typ: typeof TOKEN_TYPE.ACCESS;
  /** Login email. */
  email: string;
  /** Role membership (e.g. ["System User", "Editor"]). */
  roles: string[];
  /** Session id this token belongs to (for server-side revocation). */
  sid: string;
  /** Display name. */
  full_name?: string;
  /** Preferred UI locale (e.g. "de"). */
  language?: string;
  /**
   * Audience-set (ADR-A1): the authenticated tiers this account may enter — a
   * LIST, not a scalar, and NEVER derived from a role. Presentation-scoping only;
   * RBAC remains the data boundary. Deliberately carried under the `tiers` claim
   * ({@link AUDIENCE_CLAIM}), not the reserved JWT `aud`. NO fallback: digita-auth
   * refuses to issue a token without an assigned tier, and the engine treats a
   * claimless token as NOT internal (fail-closed) — the field is optional only so
   * the type stays additive, not because a missing value is defaulted anywhere.
   */
  tiers?: AudienceGrant[];
}

/**
 * Refresh-token payload. Rotated on every use; replay of a superseded token
 * burns the whole `family` and every session for that user.
 */
export interface RefreshTokenClaims extends BaseTokenClaims {
  typ: typeof TOKEN_TYPE.REFRESH;
  /** Unique id of THIS refresh token. The family's current jti is tracked
   *  server-side; a mismatch on refresh = replay. */
  jti: string;
  /** Rotation family id — stable across a login session's rotations. */
  family: string;
  /** Session id this refresh chain belongs to. */
  sid: string;
}

/** Pending-token payload issued between the password step and the 2FA step. */
export interface PendingTokenClaims extends BaseTokenClaims {
  typ: typeof TOKEN_TYPE.PENDING;
  /** Unique id; single-use — burned by digita-auth on successful exchange. */
  jti: string;
}

/**
 * The single operation a delegation token authorizes. Opaque to digita-auth
 * (it notarizes, it does not interpret) and ENFORCED by the target service:
 * the verified request must match this scope exactly, or the call is rejected.
 */
export interface DelegationScope {
  /** Target service the token may be replayed against, e.g. "digita-engine". */
  service: string;
  /** Entity/doctype the bound action targets. */
  entity: string;
  /** Document `_id` the action targets. */
  doc: string;
  /** Action name (the engine's `/action/:name` route). */
  action: string;
}

/**
 * Declared actor — the satellite replaying the token (e.g. "digita-jobs").
 * In Phase 1 this is self-asserted at mint and only recorded for audit; a
 * later phase can bind it to the satellite's own credential toward auth.
 */
export interface DelegationActor {
  svc: string;
}

/**
 * On-behalf delegation-token payload ({@link TOKEN_TYPE.DELEGATION}). Minted by
 * digita-auth from the delegating user's live JWT, but with roles/tiers read
 * FRESH from the user record (never trusted from the presented token), then
 * narrowed to a single {@link DelegationScope}. The target service verifies the
 * signature via the same JWKS it already uses for access tokens, checks the
 * request matches `scope`, and applies its own role-scoping — RBAC is never
 * delegated to the token, this claim only RESTRICTS.
 */
export interface DelegationTokenClaims extends BaseTokenClaims {
  typ: typeof TOKEN_TYPE.DELEGATION;
  /** Delegating user's login email. */
  email: string;
  /** The user's CURRENT raw cross-app role membership (verifier re-scopes). */
  roles: string[];
  /** Display name. */
  full_name?: string;
  /** Audience-set, resolved fresh at mint (drives the internal/external gate). */
  tiers?: AudienceGrant[];
  /** Session the delegation was minted from (forensics). */
  sid: string;
  /** Unique id — the revocation-registry key (Phase 3 exchange). */
  jti: string;
  /** The satellite replaying the token. */
  act: DelegationActor;
  /** The one operation this token authorizes. */
  scope: DelegationScope;
}

export type AnyTokenClaims =
  | AccessTokenClaims
  | RefreshTokenClaims
  | PendingTokenClaims
  | DelegationTokenClaims;

// ─── Delegation (on-behalf) HTTP API ─────────────────────

/** Path (relative to digita-auth base URL) that mints a delegation token. */
export const DELEGATION_MINT_PATH = "/api/v1/auth/delegation";
/** Path that exchanges a long-lived grant token for a short-lived run token (Phase 3). */
export const DELEGATION_EXCHANGE_PATH = "/api/v1/auth/delegation/exchange";

/**
 * Mint request — authenticated by the caller's REAL access token (Bearer or
 * cookie+CSRF). The delegating identity is taken from that token's session, so
 * a caller can only ever mint FOR THEMSELVES.
 */
export interface DelegationMintRequest {
  scope: DelegationScope;
  /** Requested lifetime; digita-auth clamps to its configured max. */
  ttl_seconds?: number;
  /** Declaring satellite (audit). */
  actor?: DelegationActor;
}

export interface DelegationMintResponse {
  /** The signed delegation JWT. */
  token: string;
  /** Expiry (epoch seconds) after clamping. */
  exp: number;
  /** The grant id (jti) — for Phase-3 revocation. */
  jti: string;
}

/**
 * Exchange request (Phase 3, C1) — trades a stored long-lived grant token for a
 * short-lived RUN token with FRESH roles + a liveness (`disabled`) re-check.
 * The grant must still be present + unrevoked in the registry.
 */
export interface DelegationExchangeRequest {
  /** The long-lived delegation token held by the satellite. */
  grant_token: string;
  /** Short run-token lifetime; digita-auth clamps to its configured max. */
  ttl_seconds?: number;
}

export type DelegationExchangeResponse = DelegationMintResponse;

// ─── JWKS shape ──────────────────────────────────────────

/** A single public key entry in the JWKS document. */
export interface Jwk {
  kty: string;
  use?: "sig";
  alg?: JwtAlgorithm;
  kid: string;
  /** RSA modulus (RS256) — base64url. */
  n?: string;
  /** RSA exponent (RS256) — base64url. */
  e?: string;
  /** OKP curve (EdDSA), e.g. "Ed25519". */
  crv?: string;
  /** OKP public key (EdDSA) — base64url. */
  x?: string;
}

export interface JwksResponse {
  keys: Jwk[];
}

// ─── HTTP API DTOs (digita-auth) ─────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

/** Returned when the user has NO 2FA — login completes in one step. */
export interface LoginSuccessResponse {
  status: "authenticated";
  access_token: string;
  refresh_token: string;
}

/** Returned when 2FA IS enabled — caller must complete the second step. */
export interface LoginPendingResponse {
  status: "two_factor_required";
  pending_token: string;
}

export type LoginResponse = LoginSuccessResponse | LoginPendingResponse;

export interface RefreshRequest {
  refresh_token: string;
}

export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
}

/** Second step of a two-factor login: exchange pending_token + code. */
export interface VerifyTwoFactorLoginRequest {
  pending_token: string;
  /** A 6-digit TOTP code OR a one-time recovery code. */
  code: string;
}

export interface LogoutRequest {
  /** Revokes a specific session; defaults to the caller's current session. */
  session_id?: string;
}

// ─── Documented defaults (informational) ─────────────────

/**
 * Reference TTLs. digita-auth is the authority on the real values (driven by
 * its own env); these document the intended contract so consumers size their
 * JWKS cache and clock-skew tolerance sensibly.
 */
export const TOKEN_TTL_REFERENCE = {
  access: "15m",
  refresh: "7d",
  pending: "5m",
} as const;

// ─── Cookie session transport ────────────────────────────

/**
 * Names of the httpOnly session cookies digita-auth sets on login/refresh and
 * the engine/post read to authenticate browser requests. Tokens never reach
 * client JS — `ACCESS`/`REFRESH` are httpOnly; `CSRF` is readable so the SPA
 * can echo it into the {@link CSRF_HEADER} for the double-submit check.
 */
export const SESSION_COOKIE = {
  /** Access JWT. httpOnly, path `/` (sent to auth + engine + post). */
  ACCESS: "digita_at",
  /** Refresh JWT. httpOnly, scoped to {@link REFRESH_COOKIE_PATH}. */
  REFRESH: "digita_rt",
  /** CSRF token. Readable (NOT httpOnly) — double-submit pattern. */
  CSRF: "digita_csrf",
} as const;

/** Header carrying the CSRF token on cookie-authenticated mutations. */
export const CSRF_HEADER = "x-csrf-token";

/** Path the refresh cookie is scoped to — the browser only sends it here. */
export const REFRESH_COOKIE_PATH = "/api/v1/auth/refresh";
