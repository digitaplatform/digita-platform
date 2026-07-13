// Generate the DEV / SAMPLE Ed25519 keypair used to sign mock plugin-entitlement
// licenses. THESE ARE SAMPLE KEYS, committed on purpose for the mock era — anyone can
// forge a license with them. Replace with real, out-of-band keys when the real
// marketplace (digitaplugins.shop) launches. Idempotent: no-op if the keys exist.
//
//   node tools/plugin-mock/gen-sample-keys.mjs
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "keys");
mkdirSync(dir, { recursive: true });
const privPath = join(dir, "dev-sample-ed25519-private.pem");
const pubPath = join(dir, "dev-sample-ed25519-public.pem");

if (existsSync(privPath) && existsSync(pubPath)) {
  console.log("DEV/SAMPLE keys already exist — nothing to do.");
  process.exit(0);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));
console.log("DEV/SAMPLE Ed25519 keypair written to", dir);
