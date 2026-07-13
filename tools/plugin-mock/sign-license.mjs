// Sign a MOCK plugin-entitlement license as an EdDSA (Ed25519) JWT using the DEV/SAMPLE
// private key. The engine verifies this offline with the SAMPLE PUBLIC key and gates
// premium plugins by the `plugins` claim. SAMPLE signing only — replace the keys for
// real customers when the real marketplace launches.
//
//   node tools/plugin-mock/sign-license.mjs --tenant dev-tenant \
//        --plugins editorial,fluent,ios,material --out tools/plugin-mock/dev-sample-license.jwt
import { createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

const here = dirname(fileURLToPath(import.meta.url));
const key = createPrivateKey(readFileSync(join(here, "keys", "dev-sample-ed25519-private.pem")));

const tenant = arg("tenant", "dev-tenant");
const plan = arg("plan", "premium");
const plugins = arg("plugins", "editorial,fluent,ios,material")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const days = Number(arg("days", "3650"));
const iat = Math.floor(Date.now() / 1000);
const exp = iat + days * 86400;

const header = { alg: "EdDSA", typ: "JWT" };
const payload = { iss: "digita-licensing", sub: tenant, plan, plugins, iat, exp };
const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const jwt = `${signingInput}.${b64url(edSign(null, Buffer.from(signingInput), key))}`;

const out = arg("out", null);
if (out) {
  writeFileSync(out, jwt + "\n");
  console.log(`license for tenant "${tenant}" (${plugins.join(", ") || "no premium"}) → ${out}`);
}
console.log(jwt);
