/**
 * x402 traffic generator — drives real nanopayments through Mimir's paid
 * endpoints so the demo shows USDC *actually flowing* (judging weight: traction).
 *
 * Each call is a real W3S-signed, Gateway-settled USDC nanopayment on Arc from
 * the oracle wallet. Premium-price calls dominate (fast, no LLM); a few council
 * reasoning reads are mixed in (revenue → persona wallets).
 *
 * Run (app serving locally or deployed):
 *   npm run dev
 *   X402_TARGET=http://localhost:3001 npm run x402:traffic
 *   COUNT=50 X402_TARGET=https://your.app npm run x402:traffic
 *
 * Env: same W3S buyer creds as x402:demo. Needs the oracle to have a Gateway
 * balance — run `npm run gateway:deposit` first.
 */

import { fetchWithBudget, usdcToAtomic } from "../lib/x402";
import { getOracleWalletId, getOracleAddress } from "../lib/circle-w3s";

const BASE = process.env.X402_TARGET ?? "http://localhost:3000";
const COUNT = Number(process.env.COUNT ?? "20");
const BUDGET = usdcToAtomic(0.01);

const SYMBOLS = ["bitcoin", "ethereum", "solana", "cardano", "dogecoin", "chainlink", "polkadot", "avalanche-2"];
const PERSONAS = ["optimist", "pessimist", "statistician", "contrarian"];

function priceUrl(i: number): string {
  return `${BASE}/api/premium/price?symbol=${SYMBOLS[i % SYMBOLS.length]}`;
}
function reasoningUrl(i: number): string {
  return `${BASE}/api/council/reasoning?claimId=1&persona=${PERSONAS[i % PERSONAS.length]}`;
}

async function main(): Promise<void> {
  for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_ORACLE_WALLET_ID", "CIRCLE_ORACLE_ADDRESS"]) {
    if (!process.env[v]) {
      console.error(`Missing env: ${v}`);
      process.exit(1);
    }
  }
  const agent = { walletId: getOracleWalletId(), address: getOracleAddress() };

  console.log(`Driving ${COUNT} nanopayments from ${agent.address} → ${BASE}\n`);

  let ok = 0;
  let totalUsd = 0;
  const t0 = Date.now();

  for (let i = 0; i < COUNT; i++) {
    // ~1 in 5 is a (slower, LLM-backed) council reasoning read; rest are prices.
    const isReasoning = i % 5 === 4;
    const url = isReasoning ? reasoningUrl(i) : priceUrl(i);
    try {
      const { response, payment } = await fetchWithBudget(url, agent, BUDGET);
      if (response.ok && payment) {
        ok++;
        totalUsd += Number(payment.priceAtomic) / 1e6;
        process.stdout.write(`✓ #${i + 1} ${isReasoning ? "reasoning" : "price"} $${(Number(payment.priceAtomic) / 1e6).toFixed(6)}\n`);
      } else {
        process.stdout.write(`✗ #${i + 1} HTTP ${response.status}\n`);
      }
    } catch (err) {
      process.stdout.write(`✗ #${i + 1} ${err instanceof Error ? err.message : "error"}\n`);
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${ok}/${COUNT} paid · $${totalUsd.toFixed(6)} USDC flowed · ${secs}s`);
  console.log(`See it live at ${BASE.replace(/\/$/, "")}/revenue`);
}

main().catch((err) => {
  console.error("[x402-traffic] FAILED:", err?.message ?? err);
  process.exit(1);
});
