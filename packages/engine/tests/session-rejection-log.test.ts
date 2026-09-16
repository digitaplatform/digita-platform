// A session token the engine cannot verify is logged once at warn with its reason and source
// (auth-middleware.ts); a request without any token stays silent — a guest visit is not a failure.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: { ENGINE_API_KEYS: [] },
}));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
}));

import { createOptionalAuthMiddleware, createAuthMiddleware } from "../src/core/auth/auth-middleware.js";
import type { AuthnPort } from "../src/core/auth/authn-port.js";
import { SESSION_COOKIE } from "@digitaplatform/shared";

class JWKSTimeoutError extends Error {
  code = "ERR_JWKS_TIMEOUT";
  constructor() { super("request timed out"); this.name = "JWKSTimeoutError"; }
}

const authn = {
  verifyAccessToken: vi.fn().mockRejectedValue(new JWKSTimeoutError()),
  verifyDelegationToken: vi.fn(),
} as unknown as AuthnPort;

function request(cookies: Record<string, string>, headers: Record<string, string> = {}) {
  return { headers, cookies, method: "GET", url: "/api/v1/boot", traceId: "t" } as unknown as Parameters<ReturnType<typeof createOptionalAuthMiddleware>>[0];
}

beforeEach(() => { warn.mockClear(); });

describe("a rejected session token is logged with its reason", () => {
  it("optional auth: one warn line naming the reason, the source and the request; the caller stays a guest", async () => {
    const req = request({ [SESSION_COOKIE.ACCESS]: "not-a-jwt" });
    await createOptionalAuthMiddleware(authn)(req);
    expect(req.user).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({
      reason: "JWKSTimeoutError: request timed out",
      code: "ERR_JWKS_TIMEOUT",
      source: "cookie",
      method: "GET",
      url: "/api/v1/boot",
    });
    expect(warn.mock.calls[0]?.[1]).toContain("rejected");
  });

  it("optional auth: no token, no line", async () => {
    await createOptionalAuthMiddleware(authn)(request({}));
    expect(warn).not.toHaveBeenCalled();
  });

  it("required auth: the same line, source bearer, and the 401 as before", async () => {
    const sent: { code?: number } = {};
    const reply = { code(c: number) { sent.code = c; return this; }, send() { return this; }, header() { return this; } } as unknown as Parameters<ReturnType<typeof createAuthMiddleware>>[1];
    await createAuthMiddleware(authn)(request({}, { authorization: "Bearer not-a-jwt" }), reply);
    expect(sent.code).toBe(401);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ source: "bearer", reason: "JWKSTimeoutError: request timed out" });
  });
});
