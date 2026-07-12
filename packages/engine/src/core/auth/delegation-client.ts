import { DELEGATION_MINT_PATH, type DelegationScope } from "@digitaplatform/shared";
import { env } from "../config/env.js";

/**
 * Mints on-behalf delegation tokens at digita-auth for hooks that drive a
 * satellite service (e.g. the ERP ZUGFeRD hook rendering via digita-report).
 * The engine holds NO signing key — it presents the USER's live access token to
 * the IdP, which mints a scoped token bound to (user, verified roles, scope).
 * The raw JWT never leaves the engine: the hook receives only the minted token.
 */
export interface EngineDelegationClient {
  mint(rawJwt: string, scope: DelegationScope): Promise<string>;
}

export function createDelegationClient(fetchImpl: typeof fetch = fetch): EngineDelegationClient {
  return {
    async mint(rawJwt, scope) {
      if (!env.AUTH_URL) {
        // No silent fallback: fail loud so the missing config is visible.
        throw new Error(
          "AUTH_URL is not configured — cannot mint an on-behalf delegation token (set AUTH_URL to the digita-auth base URL)",
        );
      }
      if (!rawJwt) {
        throw new Error("cannot mint a delegation token without the acting user's access token");
      }
      const res = await fetchImpl(`${env.AUTH_URL}${DELEGATION_MINT_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${rawJwt}` },
        body: JSON.stringify({
          scope,
          ttl_seconds: env.DELEGATION_TTL_SEC,
          actor: { svc: "digita-engine" },
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { token?: string; error?: string }
        | null;
      if (!res.ok || !body?.token) {
        throw new Error(
          `delegation mint failed (${res.status})${body?.error ? `: ${body.error}` : ""}`,
        );
      }
      return body.token;
    },
  };
}
