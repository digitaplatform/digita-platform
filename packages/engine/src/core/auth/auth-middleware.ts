import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { SESSION_COOKIE, CSRF_HEADER, ENGINE_SERVICE_HEADERS, type DelegationScope } from "@digitaplatform/shared";
import type { AuthnPort } from "./authn-port.js";
import type { UserContext } from "../permissions/types.js";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("auth-middleware");
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Extend Fastify request with user context
declare module "fastify" {
  interface FastifyRequest {
    user?: UserContext;
    locale?: string;
    traceId?: string;
    /** True when the access token came from the session cookie (→ CSRF applies). */
    authViaCookie?: boolean;
    /** The caller's raw access JWT (JWT path only). Kept engine-side to MINT
     *  on-behalf delegation tokens for hooks that call a satellite (never exposed
     *  to app hooks directly — they get the minted token via HookServices). */
    rawAccessToken?: string;
  }
}

/**
 * Resolve the access token from the httpOnly session cookie (browser) or the
 * `Authorization: Bearer` header (service-to-service / tests). `fromCookie`
 * drives CSRF enforcement: only cookie-borne auth is a CSRF vector.
 */
function extractToken(request: FastifyRequest): { token: string | null; fromCookie: boolean } {
  const cookie = request.cookies?.[SESSION_COOKIE.ACCESS];
  if (cookie) return { token: cookie, fromCookie: true };
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return { token: authHeader.slice(7), fromCookie: false };
  return { token: null, fromCookie: false };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function keyMatches(candidate: string): boolean {
  const buf = Buffer.from(candidate);
  // Compare against EVERY configured key (constant work) — no early return on
  // match, so response timing never narrows down which key matched.
  let ok = false;
  for (const key of env.ENGINE_API_KEYS) {
    const kb = Buffer.from(key);
    if (kb.length === buf.length && timingSafeEqual(kb, buf)) ok = true;
  }
  return ok;
}

/** The service identity this engine answers to in a delegation `scope.service`. */
const ENGINE_SERVICE_ID = "digita-engine";

/** A hard rejection of the trusted-service path (never a silent degrade). */
interface ServiceReject {
  status: number;
  code: string;
  detail: string;
  text: string;
}

function isReject(v: unknown): v is ServiceReject {
  return typeof v === "object" && v !== null && "status" in v && "code" in v;
}

/** The delegation token's bound operation must equal the ACTUAL request: the
 *  engine's action route (`POST /resource/:doctype/:name/action/:action_name`),
 *  same entity/doc/action, and this engine as the target service. Anything else
 *  — a different route, method, entity, doc or action — is refused. */
function requestMatchesScope(request: FastifyRequest, scope: DelegationScope): boolean {
  if (request.method !== "POST") return false;
  if (scope.service !== ENGINE_SERVICE_ID) return false;
  const p = request.params as { doctype?: string; name?: string; action_name?: string };
  return scope.entity === p.doctype && scope.doc === p.name && scope.action === p.action_name;
}

/**
 * Trusted-service path: a satellite (e.g. digita-jobs) presents a configured
 * X-Engine-Api-Key AND a signed on-behalf DELEGATION token (x-delegation-token),
 * verified via JWKS. The engine re-scopes its roles, normalizes tiers, and
 * ENFORCES the token's bound scope against the actual request. Identity is
 * never self-asserted: the token proves user X delegated exactly this.
 *
 * The legacy self-asserted `x-on-behalf-*` header path was DELETED at the
 * Phase-2 cutover — a valid key WITHOUT a delegation token is now a hard 401
 * (DELEGATION_REQUIRED), never a fabricated identity.
 *
 * The request then runs with THAT user's RBAC + audit identity, marked
 * `via_service` — never a service-admin. Returns a UserContext when the path
 * applies, null when no key header is present (fall through to JWT auth), or a
 * {@link ServiceReject} when the key/token/scope is wrong (hard 401/403).
 */
async function serviceIdentity(
  request: FastifyRequest,
  authn: AuthnPort,
): Promise<UserContext | null | ServiceReject> {
  const key = headerValue(request, ENGINE_SERVICE_HEADERS.KEY);
  if (!key) return null;
  if (env.ENGINE_API_KEYS.length === 0 || !keyMatches(key)) {
    return { status: 401, code: "SERVICE_KEY_INVALID", detail: "Invalid service key", text: "Authentication required" };
  }

  // A valid key alone proves only "a satellite is calling" — never WHO it acts
  // for. A signed delegation token is REQUIRED to attest the on-behalf identity.
  const delegToken = headerValue(request, ENGINE_SERVICE_HEADERS.DELEGATION);
  if (!delegToken) {
    return { status: 401, code: "DELEGATION_REQUIRED", detail: "A signed delegation token is required on the trusted-service path", text: "Authentication required" };
  }

  let verified;
  try {
    verified = await authn.verifyDelegationToken(delegToken);
  } catch (err) {
    log.debug({ err }, "delegation token verification failed");
    return { status: 401, code: "DELEGATION_INVALID", detail: "Invalid or expired delegation token", text: "Authentication required" };
  }
  if (!requestMatchesScope(request, verified.scope)) {
    return { status: 403, code: "DELEGATION_SCOPE_MISMATCH", detail: "Request does not match the delegation token's bound scope", text: "Forbidden" };
  }
  const u = verified.user;
  u["service_actor"] = verified.actor;
  u["delegation_jti"] = verified.jti;
  return u;
}

function unauthorized(
  request: FastifyRequest,
  reply: FastifyReply,
  code: string,
  detail: string,
  text: string,
): void {
  reply.code(401).send({
    success: false,
    status_code: 401,
    data: null,
    messages: [{ text, type: "error", show: true }],
    error: { code, detail, trace_id: request.traceId ?? "" },
  });
}

/** Send a trusted-service-path rejection with its own status (401 key/token, 403 scope). */
function denyService(request: FastifyRequest, reply: FastifyReply, r: ServiceReject): void {
  reply.code(r.status).send({
    success: false,
    status_code: r.status,
    data: null,
    messages: [{ text: r.text, type: "error", show: true }],
    error: { code: r.code, detail: r.detail, trace_id: request.traceId ?? "" },
  });
}

/**
 * Authentication middleware. Verifies the access token (cookie or bearer)
 * through the {@link AuthnPort} (JWKS-verified digita-auth tokens) and populates
 * `request.user` / `request.locale`. Stateless — session revocation is enforced
 * by digita-auth at refresh time, bounded by the short access TTL.
 */
export function createAuthMiddleware(authn: AuthnPort) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = await serviceIdentity(request, authn);
    if (isReject(service)) {
      denyService(request, reply, service);
      return;
    }
    if (service) {
      request.user = service;
      request.authViaCookie = false; // header-borne — not a CSRF vector
      return;
    }

    const { token, fromCookie } = extractToken(request);
    if (!token) {
      unauthorized(
        request,
        reply,
        "UNAUTHORIZED",
        "Missing session cookie or authorization header",
        "Authentication required",
      );
      return;
    }
    try {
      const identity = await authn.verifyAccessToken(token);
      request.user = identity.user;
      request.locale = identity.language;
      request.authViaCookie = fromCookie;
      request.rawAccessToken = token; // engine-side only — for on-behalf minting
    } catch (err) {
      log.debug({ err }, "Token verification failed");
      unauthorized(
        request,
        reply,
        "TOKEN_EXPIRED",
        "Access token is invalid or expired",
        "session_expired",
      );
    }
  };
}

/** Optional auth — sets user if a valid token (cookie or bearer) is present, never rejects. */
export function createOptionalAuthMiddleware(authn: AuthnPort) {
  return async function optionalAuth(request: FastifyRequest): Promise<void> {
    const { token, fromCookie } = extractToken(request);
    if (!token) return;
    try {
      const identity = await authn.verifyAccessToken(token);
      request.user = identity.user;
      request.locale = identity.language;
      request.authViaCookie = fromCookie;
    } catch {
      // Token invalid — proceed as guest
    }
  };
}

/**
 * CSRF guard for cookie-authenticated mutations (double-submit). Bearer auth is
 * not a CSRF vector and is exempt; so are safe (GET/HEAD) methods. A cookie-borne
 * mutation must carry an `x-csrf-token` header matching the readable CSRF cookie.
 * Registered AFTER {@link createAuthMiddleware} (it reads `request.authViaCookie`).
 */
export function createCsrfMiddleware() {
  return async function csrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.authViaCookie) return;
    if (!MUTATING.has(request.method)) return;
    const cookie = request.cookies?.[SESSION_COOKIE.CSRF];
    const raw = request.headers[CSRF_HEADER];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!cookie || cookie !== header) {
      reply.code(403).send({
        success: false,
        status_code: 403,
        data: null,
        messages: [{ text: "csrf_failed", type: "error", show: true }],
        error: {
          code: "CSRF_FAILED",
          detail: "Missing or invalid CSRF token",
          trace_id: request.traceId ?? "",
        },
      });
    }
  };
}
