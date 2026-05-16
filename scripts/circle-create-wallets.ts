/**
 * Circle W3S — create Mimir agent wallets
 *
 * One-time setup AFTER you've registered the entity secret ciphertext in
 * Circle Console (Wallets → Dev Controlled → Configurator).
 *
 * Creates:
 *   - One wallet set "mimir-agents"
 *   - Two EOA wallets on ARC-TESTNET: "oracle" and "market-creator"
 *
 * Writes wallet IDs and addresses to .env.local.
 * Idempotent: skips wallets that already exist (by env var).
 *
 * Run: npx tsx scripts/circle-create-wallets.ts
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET (both in .env.local)
 */

import { randomUUID, publicEncrypt, constants, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const CIRCLE_BASE = "https://api.circle.com/v1/w3s";

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
  if (!res.ok) throw new Error(`publicKey fetch: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data?: { publicKey?: string } };
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

async function circlePost<T>(path: string, apiKey: string, body: unknown): Promise<T> {
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
  data: { wallets: Array<{ id: string; address: string; refId?: string; blockchain: string }> };
}

async function createWalletSet(apiKey: string, ciphertext: string, name: string) {
  const resp = await circlePost<WalletSetResp>("/developer/walletSets", apiKey, {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: ciphertext,
    name,
  });
  return resp.data.walletSet;
}

async function createWallet(
  apiKey: string,
  ciphertext: string,
  walletSetId: string,
  refId: string,
  name: string,
) {
  const resp = await circlePost<WalletsResp>("/developer/wallets", apiKey, {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: ciphertext,
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    accountType: "EOA",
    metadata: [{ name, refId }],
  });
  return resp.data.wallets[0];
}

async function main(): Promise<void> {
  let env = loadEnv();
  const merged = { ...env.vars, ...process.env };
  const apiKey = merged.CIRCLE_API_KEY;
  const entitySecret = merged.CIRCLE_ENTITY_SECRET;

  if (!apiKey) throw new Error("CIRCLE_API_KEY missing in .env.local");
  if (!entitySecret) throw new Error("CIRCLE_ENTITY_SECRET missing; run scripts/circle-entity-secret.ts");

  console.log("Fetching Circle public key…");
  const pem = await fetchCirclePublicKey(apiKey);

  // 1. Wallet set
  let walletSetId = merged.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) {
    console.log("Creating wallet set 'mimir-agents'…");
    const set = await createWalletSet(apiKey, encryptEntitySecret(entitySecret, pem), "mimir-agents");
    walletSetId = set.id;
    env = upsertEnv(env, "CIRCLE_WALLET_SET_ID", walletSetId);
    writeFileSync(ENV_PATH, env.raw);
    console.log(`  → ${walletSetId}`);
  } else {
    console.log(`Reusing wallet set: ${walletSetId}`);
  }

  // 2. Oracle wallet
  if (!merged.CIRCLE_ORACLE_WALLET_ID) {
    console.log("Creating oracle wallet on ARC-TESTNET…");
    const w = await createWallet(
      apiKey,
      encryptEntitySecret(entitySecret, pem),
      walletSetId,
      "oracle",
      "Mimir Oracle",
    );
    env = upsertEnv(env, "CIRCLE_ORACLE_WALLET_ID", w.id);
    env = upsertEnv(env, "CIRCLE_ORACLE_ADDRESS", w.address);
    writeFileSync(ENV_PATH, env.raw);
    console.log(`  → id: ${w.id}`);
    console.log(`  → addr: ${w.address}`);
  } else {
    console.log(`Reusing oracle wallet: ${merged.CIRCLE_ORACLE_WALLET_ID}`);
  }

  // 3. Market-creator wallet
  if (!merged.CIRCLE_CREATOR_WALLET_ID) {
    console.log("Creating market-creator wallet on ARC-TESTNET…");
    const w = await createWallet(
      apiKey,
      encryptEntitySecret(entitySecret, pem),
      walletSetId,
      "market-creator",
      "Mimir Market Creator",
    );
    env = upsertEnv(env, "CIRCLE_CREATOR_WALLET_ID", w.id);
    env = upsertEnv(env, "CIRCLE_CREATOR_ADDRESS", w.address);
    writeFileSync(ENV_PATH, env.raw);
    console.log(`  → id: ${w.id}`);
    console.log(`  → addr: ${w.address}`);
  } else {
    console.log(`Reusing market-creator wallet: ${merged.CIRCLE_CREATOR_WALLET_ID}`);
  }

  const final = loadEnv();
  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("DONE. Wallet set + 2 wallets ready on Arc Testnet.\n");
  console.log(`Oracle address:         ${final.vars.CIRCLE_ORACLE_ADDRESS}`);
  console.log(`Market-creator address: ${final.vars.CIRCLE_CREATOR_ADDRESS}`);
  console.log("\nFund both addresses with testnet USDC:");
  console.log("  → https://faucet.circle.com  (pick Arc Testnet)");
  console.log("────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\nWallet creation failed:", err?.message ?? err);
  process.exit(1);
});
