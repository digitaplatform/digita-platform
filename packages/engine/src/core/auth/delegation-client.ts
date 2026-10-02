import { DELEGATION_MINT_PATH, type DelegationScope } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import { ConfigurationError, EngineError } from "../errors/engine-error.js";

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
        throw new ConfigurationError("setting_missing", { setting: "AUTH_URL" });
      }
      if (!rawJwt) {
        throw new EngineError("delegation_user_token_missing", {}, 500, "INTERNAL_ERROR");
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
        throw new EngineError(
          "delegation_mint_failed",
          { status: String(res.status), error: body?.error ?? "" },
          500,
          "INTERNAL_ERROR",
        );
      }
      return body.token;
    },
  };
}
