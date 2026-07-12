import { createRemoteJWKSet, createLocalJWKSet, jwtVerify } from "jose";
import { TOKEN_TYPE, AUDIENCE_CLAIM, type AudienceGrant, type DelegationScope } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";
import {
  rolesToStringArray,
  scopeRolesToApp,
  TENANT_GLOBAL_ROLES,
  type UserContext,
} from "../permissions/types.js";
import type { AuthnPort, VerifiedIdentity, VerifiedDelegation } from "./authn-port.js";

const log = createLogger("remote-authn-adapter");

// Accept either a remote JWKS set (production) or a local one (tests inject a
// `createLocalJWKSet` over a fixed key); both are valid `jwtVerify` key resolvers.
type JwksResolver =
  | ReturnType<typeof createRemoteJWKSet>
  | ReturnType<typeof createLocalJWKSet>;

// Registered JWT claims + the claims the adapter maps explicitly. Everything else
// is treated as an app-defined principal attribute (passed through for scoping).
const RESERVED_CLAIMS = new Set([
  "sub", "iss", "aud", "exp", "iat", "nbf", "jti", "typ",
  "email", "roles", "full_name", "language",
  // Audience-set (ADR-A1): mapped explicitly + normalized below, so it must NOT
  // fall through the generic extraClaims pass-through as a raw/untyped value.
  AUDIENCE_CLAIM,
  // Delegation-token structural claims — handled explicitly, never principal attrs.
  "scope", "act",
]);

/**
 * Normalize the token's `tiers` claim into a clean audience-set.
 *  - absent  → `undefined` (the caller applies its own transitional/fail-safe
 *              rule; the engine does NOT fabricate a set here, so a pre-P1 token
 *              lacking the claim isn't silently demoted).
 *  - present → the valid grants only, deduped (an unrecognized/garbage value
 *              yields `[]` = no grants = fail-closed for any gate that reads it).
 */
function normalizeTiers(v: unknown): AudienceGrant[] | undefined {
  if (v === undefined || v === null) return undefined;
  const arr = Array.isArray(v) ? v : [];
  const grants = arr.filter((x): x is AudienceGrant => x === "internal" || x === "external");
  return Array.from(new Set(grants));
}

/**
 * Verifies access tokens minted by digita-auth, offline, via its JWKS.
 * `createRemoteJWKSet` fetches + caches the public keys (with a cooldown),
 * so steady-state verification makes no network call. `iss`/`aud` are
 * enforced. The engine never issues tokens.
 *
 * The JWKS resolver is injectable for testing (a local JWKS set) — the
 * default fetches digita-auth's published keys.
 */
export class RemoteAuthnAdapter implements AuthnPort {
  private jwks: JwksResolver | undefined;
  /**
   * This engine's app name — drives per-app role scoping (D3). Defaults to
   * `env.APP_NAME` (set per-app by the chart); injectable so tests can pin it.
   */
  private readonly appName: string;

  // `jwks` is injectable for tests; otherwise built lazily on first verify so
  // the app can boot (and tests run) without resolving the JWKS URL up front.
  constructor(jwks?: JwksResolver, appName: string = env.APP_NAME) {
    this.jwks = jwks;
    this.appName = appName;
    // Startup line stating the honored role scope, so the per-app authorization
    // boundary is observable at boot rather than inferred from denials.
    log.info(
      {
        app: appName || "(unset)",
        honoredPrefix: appName ? `${appName}:` : null,
        tenantGlobalRoles: TENANT_GLOBAL_ROLES,
      },
      appName
        ? `Per-app role scoping active: honoring tenant-global roles {${TENANT_GLOBAL_ROLES.join(
            ", ",
          )}} plus token roles prefixed "${appName}:" (prefix stripped before permission mapping)`
        : `Per-app role scoping inactive (APP_NAME unset): honoring all token roles unprefixed`,
    );
  }

  private resolver(): JwksResolver {
    if (!this.jwks) this.jwks = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));
    return this.jwks;
  }

  /**
   * Build the verified principal from a token payload — shared by the access and
   * delegation paths. Roles are re-scoped to THIS engine's app (D3), tiers are
   * normalized, and every non-reserved claim carries through as a principal
   * attribute so `scope.user_field` resolves generically.
   */
  private buildUser(p: Record<string, unknown>): UserContext {
    const extraClaims: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (!RESERVED_CLAIMS.has(k)) extraClaims[k] = v;
    }
    return {
      _id: String(p["sub"]),
      email: String(p["email"] ?? ""),
      // Per-app role scoping (D3): the single tenant IdP signs cross-app roles,
      // but THIS engine only honors {Administrator, System User} plus its own
      // `<APP_NAME>:`-prefixed roles (prefix stripped). A token scoped to another
      // app resolves to zero honored roles here.
      roles: scopeRolesToApp(rolesToStringArray(p["roles"]), this.appName),
      full_name: p["full_name"] as string | undefined,
      // Audience-set (ADR-A1) — normalized; absent claim ⇒ undefined.
      tiers: normalizeTiers(p[AUDIENCE_CLAIM]),
      ...extraClaims,
    };
  }

  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    const { payload } = await jwtVerify(token, this.resolver(), {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
      algorithms: ["RS256", "EdDSA"],
    });
    const p = payload as Record<string, unknown>;
    // H18: access, refresh and pending tokens share one signing key / iss / aud —
    // only `typ` distinguishes them. Without this gate a refresh or (pre-2FA)
    // pending token presented as a bearer verifies as an access token, populating
    // request.user without completing the second factor. Reject anything but access.
    if (p["typ"] !== TOKEN_TYPE.ACCESS) {
      throw new Error(
        `Invalid token type: expected "${TOKEN_TYPE.ACCESS}", got "${String(p["typ"])}"`,
      );
    }
    return { user: this.buildUser(p), language: p["language"] as string | undefined };
  }

  async verifyDelegationToken(token: string): Promise<VerifiedDelegation> {
    const { payload } = await jwtVerify(token, this.resolver(), {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
      algorithms: ["RS256", "EdDSA"],
    });
    const p = payload as Record<string, unknown>;
    if (p["typ"] !== TOKEN_TYPE.DELEGATION) {
      throw new Error(
        `Invalid token type: expected "${TOKEN_TYPE.DELEGATION}", got "${String(p["typ"])}"`,
      );
    }
    const scope = p["scope"] as DelegationScope | undefined;
    if (
      !scope ||
      typeof scope.service !== "string" ||
      typeof scope.entity !== "string" ||
      typeof scope.doc !== "string" ||
      typeof scope.action !== "string"
    ) {
      throw new Error("Delegation token is missing a well-formed scope");
    }
    const act = p["act"] as { svc?: unknown } | undefined;
    return {
      user: { ...this.buildUser(p), via_service: true },
      scope,
      actor: typeof act?.svc === "string" ? act.svc : "unknown",
      jti: typeof p["jti"] === "string" ? p["jti"] : "",
    };
  }
}
