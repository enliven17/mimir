/**
 * Circle Entity Secret bootstrap
 *
 * One-time setup for Circle W3S (Programmable Wallets):
 *   1. Generates a 32-byte entity secret (kept locally forever)
 *   2. Fetches Circle's RSA public key
 *   3. Encrypts the entity secret with RSA-OAEP / SHA-256
 *   4. Appends CIRCLE_ENTITY_SECRET to .env.local
 *   5. Prints the ciphertext for one-time Console registration
 *
 * Re-run after registration: every W3S API call re-encrypts the entity secret
 * (Circle SDK does that automatically; this script is only for first-time setup).
 *
 * Run: npx tsx scripts/circle-entity-secret.ts
 * Env: CIRCLE_API_KEY (from .env.local)
 */

import { randomBytes, publicEncrypt, constants, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH      = resolve(process.cwd(), ".env.local");
const CIRCLE_API    = "https://api.circle.com/v1/w3s/config/entity/publicKey";

function loadDotenvLocal(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const raw = readFileSync(ENV_PATH, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function fetchPublicKey(apiKey: string): Promise<string> {
  const res = await fetch(CIRCLE_API, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Circle public key fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json() as { data?: { publicKey?: string } };
  const pem = json?.data?.publicKey;
  if (!pem) throw new Error("No publicKey in Circle response");
  return pem;
}

function encryptEntitySecret(entitySecretHex: string, publicKeyPem: string): string {
  const key = createPublicKey({ key: publicKeyPem, format: "pem" });
  const buf = Buffer.from(entitySecretHex, "hex");
  const cipher = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    buf,
  );
  return cipher.toString("base64");
}

function appendEntitySecret(entitySecretHex: string): void {
  let raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  if (/^CIRCLE_ENTITY_SECRET=/m.test(raw)) {
    raw = raw.replace(/^CIRCLE_ENTITY_SECRET=.*$/m, `CIRCLE_ENTITY_SECRET=${entitySecretHex}`);
  } else if (/^#\s*CIRCLE_ENTITY_SECRET=/m.test(raw)) {
    raw = raw.replace(/^#\s*CIRCLE_ENTITY_SECRET=.*$/m, `CIRCLE_ENTITY_SECRET=${entitySecretHex}`);
  } else {
    if (!raw.endsWith("\n")) raw += "\n";
    raw += `CIRCLE_ENTITY_SECRET=${entitySecretHex}\n`;
  }
  writeFileSync(ENV_PATH, raw);
}

async function main(): Promise<void> {
  const env = { ...loadDotenvLocal(), ...process.env };
  const apiKey = env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error("CIRCLE_API_KEY missing from .env.local");
    process.exit(1);
  }

  if (env.CIRCLE_ENTITY_SECRET) {
    console.log("CIRCLE_ENTITY_SECRET already set in .env.local.");
    console.log("Re-generating a NEW ciphertext from the existing secret for re-registration…\n");
    const pem = await fetchPublicKey(apiKey);
    const ciphertext = encryptEntitySecret(env.CIRCLE_ENTITY_SECRET, pem);
    console.log("Ciphertext (paste into Circle Console → Configurator → Register Entity Secret):\n");
    console.log(ciphertext);
    return;
  }

  console.log("Generating new entity secret (32 bytes)…");
  const entitySecret = randomBytes(32).toString("hex");

  console.log("Fetching Circle public key…");
  const pem = await fetchPublicKey(apiKey);

  console.log("Encrypting entity secret (RSA-OAEP / SHA-256)…");
  const ciphertext = encryptEntitySecret(entitySecret, pem);

  console.log("Saving CIRCLE_ENTITY_SECRET to .env.local…");
  appendEntitySecret(entitySecret);

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("DONE. Next step:");
  console.log("");
  console.log("Go to Circle Console → Configurator → Register Entity Secret,");
  console.log("and paste the ciphertext below:");
  console.log("");
  console.log(ciphertext);
  console.log("");
  console.log("After registration you can run W3S API calls (we'll wire that next).");
  console.log("────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("Entity secret bootstrap failed:", err?.message ?? err);
  process.exit(1);
});
