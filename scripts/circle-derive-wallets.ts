/**
 * Circle W3S — put every Mimir agent wallet on Base Sepolia and Arbitrum Sepolia.
 *
 * The agents were created on ARC-TESTNET. Deriving keeps each agent's ADDRESS
 * and gives it a wallet id per chain, so the oracle, the market creator and
 * every council persona are the same account on all three networks.
 *
 * Writes <WALLET_ID env>_BASE and <WALLET_ID env>_ARBITRUM to .env.local next to
 * the Arc ids, and refuses to write if Circle ever hands back a different
 * address (that would split an agent into two identities).
 *
 * Run: npm run circle:derive-wallets
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and the Arc wallet ids/addresses.
 * Gas: fund each address with Sepolia ETH on Base and Arbitrum afterwards;
 *      stakes need testnet USDC there too (https://faucet.circle.com).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { deriveWallet } from "../lib/circle-w3s";
import { CHAINS, type ChainKey } from "../lib/chains";
import { walletIdEnvFor } from "../lib/w3s-escrow";
import { COUNCIL_PERSONAS, personaAddressEnv, personaWalletIdEnv } from "../agents/council/personas";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const TARGETS: ChainKey[] = ["base", "arbitrum"];

const AGENTS: Array<{ label: string; idEnv: string; addressEnv: string }> = [
  { label: "oracle", idEnv: "CIRCLE_ORACLE_WALLET_ID", addressEnv: "CIRCLE_ORACLE_ADDRESS" },
  { label: "market-creator", idEnv: "CIRCLE_CREATOR_WALLET_ID", addressEnv: "CIRCLE_CREATOR_ADDRESS" },
  ...COUNCIL_PERSONAS.map((p) => ({
    label: `council/${p.slug}`,
    idEnv: personaWalletIdEnv(p),
    addressEnv: personaAddressEnv(p),
  })),
];

function upsertEnv(raw: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  if (new RegExp(`^#?\s*${key}=`, "m").test(raw)) {
    return raw.replace(new RegExp(`^#?\s*${key}=.*$`, "m"), line);
  }
  return `${raw.endsWith("\n") || raw === "" ? raw : `${raw}\n`}${line}\n`;
}

async function main() {
  let env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  let derived = 0;

  for (const agent of AGENTS) {
    const arcId = process.env[agent.idEnv]?.trim();
    if (!arcId) {
      console.log(`skip ${agent.label}: ${agent.idEnv} not set`);
      continue;
    }
    const expected = process.env[agent.addressEnv]?.trim().toLowerCase();

    for (const chain of TARGETS) {
      const key = walletIdEnvFor(agent.idEnv, chain);
      if (process.env[key]?.trim()) {
        console.log(`ok   ${agent.label} on ${CHAINS[chain].name}: ${key} already set`);
        continue;
      }
      const wallet = await deriveWallet(arcId, CHAINS[chain].w3sBlockchain);
      if (expected && wallet.address.toLowerCase() !== expected) {
        throw new Error(
          `${agent.label}: derived ${wallet.address} on ${chain}, expected ${expected}. Not writing it.`,
        );
      }
      env = upsertEnv(env, key, wallet.id);
      derived++;
      console.log(`new  ${agent.label} on ${CHAINS[chain].name}: ${key}=${wallet.id} (${wallet.address})`);
    }
  }

  if (derived > 0) {
    writeFileSync(ENV_PATH, env);
    console.log(`\nWrote ${derived} wallet id(s) to .env.local. Copy them to Railway/Vercel too.`);
  } else {
    console.log("\nNothing to derive.");
  }
}

main().catch((err) => {
  console.error("derive failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
