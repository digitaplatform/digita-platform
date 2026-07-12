// The engine mints on-behalf delegation tokens at digita-auth for hooks that
// drive a satellite (e.g. the ERP ZUGFeRD hook → digita-report). No signing key
// here — it forwards the user's JWT; auth mints. Fail loud, never a silent default.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELEGATION_MINT_PATH } from "@digitaplatform/shared";

const envMock = vi.hoisted(() => ({ AUTH_URL: "http://auth.local", DELEGATION_TTL_SEC: 300 }));
vi.mock("../src/core/config/env.js", () => ({ env: envMock }));

import { createDelegationClient } from "../src/core/auth/delegation-client.js";

const scope = { service: "digita-report", entity: "erp-invoice", doc: "INV-1", action: "render" };

function fetchStub(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

describe("engine delegation mint client", () => {
  beforeEach(() => {
    envMock.AUTH_URL = "http://auth.local";
    vi.clearAllMocks();
  });

  it("POSTs the user's JWT + scope to the auth mint endpoint and returns the token", async () => {
    const f = fetchStub({ token: "signed.jwt", exp: 123, jti: "g1" });
    const client = createDelegationClient(f);
    const token = await client.mint("user.jwt", scope);
    expect(token).toBe("signed.jwt");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe(`http://auth.local${DELEGATION_MINT_PATH}`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer user.jwt");
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.scope).toEqual(scope);
    expect(sent.actor).toEqual({ svc: "digita-engine" });
    expect(sent.ttl_seconds).toBe(300);
  });

  it("throws loudly when AUTH_URL is not configured (no silent fallback)", async () => {
    envMock.AUTH_URL = "";
    const client = createDelegationClient(fetchStub({ token: "x" }));
    await expect(client.mint("user.jwt", scope)).rejects.toThrow(/AUTH_URL is not configured/);
  });

  it("throws without the acting user's token", async () => {
    const client = createDelegationClient(fetchStub({ token: "x" }));
    await expect(client.mint("", scope)).rejects.toThrow(/without the acting user's access token/);
  });

  it("throws with the status on an auth error", async () => {
    const client = createDelegationClient(fetchStub({ error: "audience_not_assigned" }, false, 401));
    await expect(client.mint("user.jwt", scope)).rejects.toThrow(/mint failed \(401\).*audience_not_assigned/);
  });
});
