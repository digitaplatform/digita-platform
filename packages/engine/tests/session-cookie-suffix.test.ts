// The session cookie names carry the unit's suffix. Two IdPs stand under one apex and the browser
// sends both zones' cookies to every tenant host, so with AUTH_COOKIE_SUFFIX set the engine must
// read ONLY `digita_at_<suffix>` — a bare `digita_at` from the platform IdP is not even offered to
// the verifier, which would reject it against this tenant's JWKS.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: { ENGINE_API_KEYS: [] as string[], AUTH_COOKIE_SUFFIX: "" },
}));
vi.mock("../src/core/config/env.js", () => ({ env: envMock }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { sessionCookieNames, SESSION_COOKIE, CSRF_HEADER } from "@digitaplatform/shared";
import type { AuthnPort } from "../src/core/auth/authn-port.js";

const GUID = "a1b2c3d4e5f6";

const verifyAccessToken = vi.fn().mockResolvedValue({ user: { id: "u1", roles: [] } });
const authn = { verifyAccessToken, verifyDelegationToken: vi.fn() } as unknown as AuthnPort;

/** The middleware re-imported with a fresh suffix — the names are composed once at module scope. */
async function middlewareWith(suffix: string) {
  envMock.AUTH_COOKIE_SUFFIX = suffix;
  vi.resetModules();
  return import("../src/core/auth/auth-middleware.js");
}

function request(cookies: Record<string, string>, method = "GET", headers: Record<string, string> = {}) {
  return { headers, cookies, method, url: "/api/v1/boot", traceId: "t" } as never;
}

beforeEach(() => verifyAccessToken.mockClear());

describe("sessionCookieNames", () => {
  it("is the bare contract names when there is no suffix — the platform IdP and post keep them", () => {
    expect(sessionCookieNames()).toEqual({ ACCESS: "digita_at", REFRESH: "digita_rt", CSRF: "digita_csrf" });
    expect(sessionCookieNames("")).toEqual({ ...SESSION_COOKIE });
  });

  it("appends the tenant guid to each of the three names", () => {
    expect(sessionCookieNames(GUID)).toEqual({
      ACCESS: `digita_at_${GUID}`,
      REFRESH: `digita_rt_${GUID}`,
      CSRF: `digita_csrf_${GUID}`,
    });
  });

  it("refuses a suffix outside the tenant guid's alphabet, so no separator can reach a cookie name", () => {
    for (const bad of ["A1B2", "a-b", "a_b", "a.b", "a b", "a".repeat(33)]) {
      expect(() => sessionCookieNames(bad), bad).toThrow(/Invalid session cookie suffix/);
    }
  });
});

describe("the engine reads the session cookies of its own unit", () => {
  it("verifies the access token from the suffixed cookie", async () => {
    const { createOptionalAuthMiddleware } = await middlewareWith(GUID);
    const req = request({ [`digita_at_${GUID}`]: "tenant-jwt" });
    await createOptionalAuthMiddleware(authn)(req);
    expect(verifyAccessToken).toHaveBeenCalledWith("tenant-jwt");
    expect((req as { user?: unknown }).user).toBeDefined();
  });

  it("ignores the platform IdP's bare cookie while a suffix is set — no verification is attempted", async () => {
    const { createOptionalAuthMiddleware } = await middlewareWith(GUID);
    const req = request({ [SESSION_COOKIE.ACCESS]: "platform-jwt" });
    await createOptionalAuthMiddleware(authn)(req);
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect((req as { user?: unknown }).user).toBeUndefined();
  });

  it("reads the bare cookie as before when no suffix is set", async () => {
    const { createOptionalAuthMiddleware } = await middlewareWith("");
    const req = request({ [SESSION_COOKIE.ACCESS]: "platform-jwt" });
    await createOptionalAuthMiddleware(authn)(req);
    expect(verifyAccessToken).toHaveBeenCalledWith("platform-jwt");
  });

  it("matches the CSRF header against the suffixed CSRF cookie", async () => {
    const { createCsrfMiddleware } = await middlewareWith(GUID);
    const sent: { code?: number } = {};
    const reply = {
      code(c: number) { sent.code = c; return this; },
      send() { return this; },
    } as never;
    const req = request({ [`digita_csrf_${GUID}`]: "tok" }, "POST", { [CSRF_HEADER]: "tok" });
    (req as { authViaCookie?: boolean }).authViaCookie = true;
    await createCsrfMiddleware()(req, reply);
    expect(sent.code).toBeUndefined();
  });

  it("rejects a mutation whose CSRF header only matches the platform IdP's bare cookie", async () => {
    const { createCsrfMiddleware } = await middlewareWith(GUID);
    const sent: { code?: number } = {};
    const reply = {
      code(c: number) { sent.code = c; return this; },
      send() { return this; },
    } as never;
    const req = request({ [SESSION_COOKIE.CSRF]: "tok" }, "POST", { [CSRF_HEADER]: "tok" });
    (req as { authViaCookie?: boolean }).authViaCookie = true;
    await createCsrfMiddleware()(req, reply);
    expect(sent.code).toBe(403);
  });
});
