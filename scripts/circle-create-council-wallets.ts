/**
 * Circle W3S — create Mimir Council persona wallets (10 wallets, batch).
 *
 * Run AFTER:
 *   1. CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET are configured
 *   2. The entity-secret ciphertext is registered in Circle Console
 *      (Wallets → Dev Controlled → Configurator)
 *
 * Strategy:
 *   - Reuse the existing CIRCLE_WALLET_SET_ID (created by circle-create-wallets.ts).
 *     Falls back to creating a "mimir-council" wallet set if none exists.
 *   - Iterates over COUNCIL_PERSONAS and creates one EOA per persona on
 *     ARC-TESTNET. Idempotent — skips personas whose wallet ID is already set.
 *   - Writes CIRCLE_COUNCIL_<SLUG_UPPER>_WALLET_ID and _ADDRESS pairs to
 *     .env.local in one pass.
 *   - Pauses ~400ms between calls so we don't trip Circle rate limits.
 *
 * Run: npx tsx --env-file=.env.local scripts/circle-create-council-wallets.ts
 */

import {
  randomUUID,
  publicEncrypt,
  constants,
  createPublicKey,
} from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  COUNCIL_PERSONAS,
  personaAddressEnv,
  personaWalletIdEnv,
  type PersonaSpec,
} from "../agents/council/personas";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const CIRCLE_BASE = "https://api.circle.com/v1/w3s";
const RATE_LIMIT_DELAY_MS = 400;

interface EnvFile {
  raw: string;
  vars: Record<string, string>;
}

function loadEnv(): EnvFile {
  const raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const vars: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return { raw, vars };
}

function upsertEnv(env: EnvFile, key: string, value: string): EnvFile {
  let raw = env.raw;
  if (new RegExp(`^${key}=`, "m").test(raw)) {
    raw = raw.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  } else if (new RegExp(`^#\\s*${key}=`, "m").test(raw)) {
    raw = raw.replace(new RegExp(`^#\\s*${key}=.*$`, "m"), `${key}=${value}`);
  } else {
    if (!raw.endsWith("\n")) raw += "\n";
    raw += `${key}=${value}\n`;
  }
  return { raw, vars: { ...env.vars, [key]: value } };
}

async function fetchCirclePublicKey(apiKey: string): Promise<string> {
  const res = await fetch(`${CIRCLE_BASE}/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`publicKey fetch: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: { publicKey?: string } };
  if (!json?.data?.publicKey) throw new Error("No publicKey in response");
  return json.data.publicKey;
}

function encryptEntitySecret(entitySecretHex: string, pem: string): string {
  const key = createPublicKey({ key: pem, format: "pem" });
  const buf = Buffer.from(entitySecretHex, "hex");
  const cipher = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    buf,
  );
  return cipher.toString("base64");
}

async function circlePost<T>(
  path: string,
  apiKey: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${CIRCLE_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

interface WalletSetResp {
  data: { walletSet: { id: string; name: string } };
}
interface WalletsResp {
  data: {
    wallets: Array<{
      id: string;
      address: string;
      refId?: string;
      blockchain: string;
    }>;
  };
}

async function createWalletSet(
  apiKey: string,
  ciphertext: string,
  name: string,
) {
  const resp = await circlePost<WalletSetResp>(
    "/developer/walletSets",
    apiKey,
    {
      idempotencyKey: randomUUID(),
      entitySecretCiphertext: ciphertext,
      name,
    },
  );
  return resp.data.walletSet;
}

async function createPersonaWallet(
  apiKey: string,
  pem: string,
  entitySecret: string,
  walletSetId: string,
  persona: PersonaSpec,
) {
  const resp = await circlePost<WalletsResp>("/developer/wallets", apiKey, {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: encryptEntitySecret(entitySecret, pem),
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    accountType: "EOA",
    metadata: [
      {
        name: `Mimir Council — ${persona.displayName}`,
        refId: `council-${persona.slug}`,
      },
    ],
  });
  return resp.data.wallets[0];
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  let env = loadEnv();
  const merged = { ...env.vars, ...process.env };
  const apiKey = merged.CIRCLE_API_KEY;
  const entitySecret = merged.CIRCLE_ENTITY_SECRET;

  if (!apiKey) throw new Error("CIRCLE_API_KEY missing in .env.local");
  if (!entitySecret) {
    throw new Error(
      "CIRCLE_ENTITY_SECRET missing; run scripts/circle-entity-secret.ts first",
    );
  }

  console.log("Fetching Circle public key…");
  const pem = await fetchCirclePublicKey(apiKey);

  let walletSetId = merged.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) {
    console.log("No existing wallet set; creating 'mimir-council'…");
    const set = await createWalletSet(
      apiKey,
      encryptEntitySecret(entitySecret, pem),
      "mimir-council",
    );
    walletSetId = set.id;
    env = upsertEnv(env, "CIRCLE_WALLET_SET_ID", walletSetId);
    writeFileSync(ENV_PATH, env.raw);
    console.log(`  → ${walletSetId}`);
  } else {
    console.log(`Reusing wallet set: ${walletSetId}`);
  }

  const createdAddresses: Array<{ persona: PersonaSpec; address: string }> = [];

  for (const persona of COUNCIL_PERSONAS) {
    const walletIdKey = personaWalletIdEnv(persona);
    const addressKey = personaAddressEnv(persona);

    // Re-read env in case earlier iterations updated it
    const fresh = loadEnv();
    const existingId = fresh.vars[walletIdKey] ?? merged[walletIdKey];
    const existingAddr = fresh.vars[addressKey] ?? merged[addressKey];

    if (existingId && existingAddr) {
      console.log(
        `[skip] ${persona.emoji} ${persona.displayName.padEnd(24)} ${existingAddr}`,
      );
      createdAddresses.push({ persona, address: existingAddr });
      continue;
    }

    console.log(`[create] ${persona.emoji} ${persona.displayName}…`);
    const w = await createPersonaWallet(
      apiKey,
      pem,
      entitySecret,
      walletSetId,
      persona,
    );

    env = loadEnv();
    env = upsertEnv(env, walletIdKey, w.id);
    env = upsertEnv(env, addressKey, w.address);
    writeFileSync(ENV_PATH, env.raw);

    console.log(`  → ${w.address}`);
    createdAddresses.push({ persona, address: w.address });

    await sleep(RATE_LIMIT_DELAY_MS);
  }

  console.log(
    "\n══════════════════════════════════════════════════════════════════════",
  );
  console.log("  MIMIR COUNCIL — wallets ready on Arc Testnet");
  console.log(
    "══════════════════════════════════════════════════════════════════════\n",
  );

  for (const { persona, address } of createdAddresses) {
    console.log(
      `  ${persona.emoji} ${persona.displayName.padEnd(24)} ${address}`,
    );
  }

  console.log(`\nFund each address (5 USDC recommended):`);
  console.log(`  → https://faucet.circle.com  (pick Arc Testnet)\n`);
  console.log("After funding, run:");
  console.log("  npm run council\n");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("\nCouncil wallet creation failed:", msg);
  process.exit(1);
});
