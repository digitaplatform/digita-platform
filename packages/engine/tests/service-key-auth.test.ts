// Trusted-service path of the auth middleware (digita-jobs et al.): a
// configured X-Engine-Api-Key alone is NOT enough — since the Phase-2 cutover a
// signed x-delegation-token is REQUIRED to attest the on-behalf identity. The
// legacy self-asserted x-on-behalf-* header path was DELETED: a valid key with
// no delegation token (or with only legacy headers) is a hard 401
// DELEGATION_REQUIRED, and never falls through to JWT auth.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  // auth-middleware only reads ENGINE_API_KEYS — a full env would demand
  // MONGODB_URI etc., which these unit tests don't have or need.
  env: { ENGINE_API_KEYS: ["key-live", "key-next"] },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { createAuthMiddleware } from "../src/core/auth/auth-middleware.js";
import type { AuthnPort } from "../src/core/auth/authn-port.js";

const authn: AuthnPort = {
  verifyAccessToken: vi.fn().mockRejectedValue(new Error("no jwt in these tests")),
  verifyDelegationToken: vi.fn(),
} as unknown as AuthnPort;

interface Sent {
  code?: number;
  body?: { error?: { code?: string } };
}

function makeReqReply(
  headers: Record<string, string>,
  opts: { method?: string; params?: Record<string, string> } = {},
) {
  const sent: Sent = {};
  const request = {
    headers,
    cookies: {},
    traceId: "t",
    method: opts.method ?? "GET",
    params: opts.params ?? {},
  } as unknown as Parameters<ReturnType<typeof createAuthMiddleware>>[0];
  const reply = {
    code(c: number) {
      sent.code = c;
      return this;
    },
    send(b: Sent["body"]) {
      sent.body = b;
      return this;
    },
  } as unknown as Parameters<ReturnType<typeof createAuthMiddleware>>[1];
  return { request, reply, sent };
}

describe("engine service-key auth", () => {
  const authenticate = createAuthMiddleware(authn);

  beforeEach(() => vi.clearAllMocks());

  // CANARY (Phase-2 cutover): the legacy self-asserted on-behalf header path is
  // DELETED. A valid key + forged x-on-behalf-* headers no longer fabricates that
  // user's context — it is rejected with a hard 401 DELEGATION_REQUIRED, and the
  // verifyDelegationToken path is never even reached (no token present).
  it("valid key + legacy on-behalf headers (no delegation token) → hard 401 DELEGATION_REQUIRED", async () => {
    const { request, reply, sent } = makeReqReply({
      "x-engine-api-key": "key-live",
      "x-on-behalf-of": "mk@simetrix.ch",
      "x-on-behalf-roles": "Salesperson, Sales Manager",
      "x-on-behalf-name": "MK",
    });
    await authenticate(request, reply);
    expect(sent.code).toBe(401);
    expect(sent.body?.error?.code).toBe("DELEGATION_REQUIRED");
    expect(request.user).toBeUndefined();
    expect(authn.verifyDelegationToken).not.toHaveBeenCalled();
    expect(authn.verifyAccessToken).not.toHaveBeenCalled();
  });

  // CANARY (Phase-2 cutover): a valid ROTATION key + a forged Administrator
  // on-behalf header is likewise refused — the key never attested identity.
  it("rotation key + forged Administrator on-behalf header → hard 401 DELEGATION_REQUIRED", async () => {
    const { request, reply, sent } = makeReqReply({
      "x-engine-api-key": "key-next",
      "x-on-behalf-of": "a@b.c",
      "x-on-behalf-roles": "Administrator",
    });
    await authenticate(request, reply);
    expect(sent.code).toBe(401);
    expect(sent.body?.error?.code).toBe("DELEGATION_REQUIRED");
    expect(request.user).toBeUndefined();
  });

  it("wrong key → hard 401 SERVICE_KEY_INVALID (no JWT fallthrough)", async () => {
    const { request, reply, sent } = makeReqReply({
      "x-engine-api-key": "wrong",
      "x-on-behalf-of": "a@b.c",
      "x-on-behalf-roles": "Administrator",
    });
    await authenticate(request, reply);
    expect(sent.code).toBe(401);
    expect(sent.body?.error?.code).toBe("SERVICE_KEY_INVALID");
    expect(authn.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("valid key but NO delegation token → hard 401 DELEGATION_REQUIRED", async () => {
    const { request, reply, sent } = makeReqReply({ "x-engine-api-key": "key-live" });
    await authenticate(request, reply);
    expect(sent.code).toBe(401);
    expect(sent.body?.error?.code).toBe("DELEGATION_REQUIRED");
  });

  it("no key header → normal JWT path (here: 401 from missing token)", async () => {
    const { request, reply, sent } = makeReqReply({});
    await authenticate(request, reply);
    expect(sent.code).toBe(401);
    expect(sent.body?.error?.code).toBe("UNAUTHORIZED");
  });
});

describe("engine service-key auth — signed delegation token", () => {
  const authenticate = createAuthMiddleware(authn);
  const scope = { service: "digita-engine", entity: "SalesInvoice", doc: "INV-1", action: "recompute" };
  const verified = {
    user: { _id: "boss@t.local", email: "boss@t.local", roles: ["Manager"], via_service: true },
    scope,
    actor: "digita-jobs",
    jti: "grant-1",
  };
  const actionRoute = { method: "POST", params: { doctype: "SalesInvoice", name: "INV-1", action_name: "recompute" } };

  beforeEach(() => vi.clearAllMocks());

  it("valid key + valid delegation token on the bound action route → that user, via_service + actor + jti", async () => {
    (authn.verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValue(verified);
    const { request, reply, sent } = makeReqReply(
      { "x-engine-api-key": "key-live", "x-delegation-token": "signed.jwt.here" },
      actionRoute,
    );
    await authenticate(request, reply);
    expect(sent.code).toBeUndefined();
    expect(authn.verifyDelegationToken).toHaveBeenCalledWith("signed.jwt.here");
    expect(request.user).toMatchObject({
      _id: "boss@t.local",
      roles: ["Manager"],
      via_service: true,
      service_actor: "digita-jobs",
      delegation_jti: "grant-1",
    });
  });

  it("delegation token but the request is NOT its bound operation → 403 scope mismatch", async () => {
    (authn.verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValue(verified);
    const { request, reply, sent } = makeReqReply(
      { "x-engine-api-key": "key-live", "x-delegation-token": "signed.jwt.here" },
      { method: "POST", params: { doctype: "SalesInvoice", name: "INV-1", action_name: "delete_everything" } },
    );
    await authenticate(request, reply);
    expect(sent.code).toBe(403);
    expect(sent.body?.error?.code).toBe("DELEGATION_SCOPE_MISMATCH");
  });

  it("delegation token that fails verification → hard 401 DELEGATION_INVALID (no fallthrough)", async () => {
    (authn.verifyDelegationToken as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("bad sig"));
    const { request, reply, sent } = makeReqReply(
      { "x-engine-api-key": "key-live", "x-delegation-token": "tampered" },
      actionRoute,
    );
    await authenticate(request, reply);
    expect(sent.code).toBe(401);
    expect(sent.body?.error?.code).toBe("DELEGATION_INVALID");
    expect(authn.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("delegation token WINS over legacy on-behalf headers when both are present", async () => {
    (authn.verifyDelegationToken as ReturnType<typeof vi.fn>).mockResolvedValue(verified);
    const { request, reply, sent } = makeReqReply(
      {
        "x-engine-api-key": "key-live",
        "x-delegation-token": "signed.jwt.here",
        "x-on-behalf-of": "attacker@evil.com",
        "x-on-behalf-roles": "Administrator",
      },
      actionRoute,
    );
    await authenticate(request, reply);
    expect(sent.code).toBeUndefined();
    // The forged Administrator identity is ignored — the token's scoped identity wins.
    expect(request.user?._id).toBe("boss@t.local");
    expect(request.user?.roles).toEqual(["Manager"]);
  });
});
