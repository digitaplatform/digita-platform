import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { AUDIENCE_CLAIM } from "@digitaplatform/shared";
import { RemoteAuthnAdapter } from "../src/core/auth/remote-authn-adapter.js";

/**
 * Test helper: builds a RemoteAuthnAdapter backed by a LOCAL JWKS (a freshly
 * generated RS256 key) plus a `sign()` that mints matching access tokens.
 * Lets the engine's verify path be exercised without a running digita-auth.
 *
 * `appName` pins the adapter's per-app role scope (D3); omit it to inherit
 * `env.APP_NAME` (the production default, empty in tests → scoping disabled).
 */
export async function buildTestAuth(appName?: string): Promise<{
  authn: RemoteAuthnAdapter;
  sign: (claims: {
    sub: string;
    email: string;
    roles: string[];
    full_name?: string;
    language?: string;
    typ?: string;
    tiers?: string[];
  }) => Promise<string>;
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", use: "sig", alg: "RS256" };
  const authn = new RemoteAuthnAdapter(createLocalJWKSet({ keys: [jwk] }), appName);

  const sign = (claims: {
    sub: string;
    email: string;
    roles: string[];
    full_name?: string;
    language?: string;
    typ?: string;
    tiers?: string[];
  }): Promise<string> =>
    new SignJWT({
      typ: claims.typ ?? "access",
      email: claims.email,
      roles: claims.roles,
      full_name: claims.full_name,
      language: claims.language,
      // Audience-set (ADR-A1) under the `tiers` claim. Defaults to ["internal"]
      // so a plain test token models a normal logged-in operator (auth refuses to
      // issue a token without a tier). Pass tiers:[] for the fail-closed/no-grant
      // path or ["external"] for the external audience.
      [AUDIENCE_CLAIM]: claims.tiers ?? ["internal"],
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(privateKey);

  return { authn, sign };
}
