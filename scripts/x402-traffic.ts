/**
 * x402 traffic generator — drives real nanopayments through Mimir's paid
 * endpoints so the demo shows USDC *actually flowing* (judging weight: traction).
 *
 * Each call is a real W3S-signed, Gateway-settled USDC nanopayment from the
 * oracle wallet. Premium-price calls dominate (fast, no LLM); a few council
 * reasoning reads are mixed in (revenue → persona wallets).
 *
 * Multichain: the preferred network rotates per request across the enabled
 * chains where the oracle has a W3S wallet, so the payments really are mixed
 * across Arc, Base and Arbitrum. Reasoning reads target claim #1 on the
 * request's chain (`&chain=`).
 *
 * Run (app serving locally or deployed):
 *   npm run dev
 *   X402_TARGET=http://localhost:3001 npm run x402:traffic
 *   COUNT=50 X402_TARGET=https://your.app npm run x402:traffic
 *
 * Env: same W3S buyer creds as x402:demo. Needs the oracle to have a Gateway
 * balance on each network — run `npm run gateway:deposit` first.
 */

import { fetchWithBudget, usdcToAtomic } from "../lib/x402";
import { getOracleAddress } from "../lib/circle-w3s";
import type { ChainKey } from "../lib/chains";
import { chainQuery, payingAgentFor, walletChains } from "../agents/shared/chains";

const BASE = process.env.X402_TARGET ?? "http://localhost:3000";
const COUNT = Number(process.env.COUNT ?? "20");
const BUDGET = usdcToAtomic(0.01);
const WALLET_ENV = "CIRCLE_ORACLE_WALLET_ID";

const SYMBOLS = ["bitcoin", "ethereum", "solana", "cardano", "dogecoin", "chainlink", "polkadot", "avalanche-2"];
const PERSONAS = ["optimist", "pessimist", "statistician", "contrarian"];

function priceUrl(i: number): string {
  return `${BASE}/api/premium/price?symbol=${SYMBOLS[i % SYMBOLS.length]}`;
}
function reasoningUrl(i: number, chain: ChainKey): string {
  return `${BASE}/api/council/reasoning?claimId=1&persona=${PERSONAS[i % PERSONAS.length]}${chainQuery(chain)}`;
}

async function main(): Promise<void> {
  for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_ORACLE_ADDRESS"]) {
    if (!process.env[v]) {
      console.error(`Missing env: ${v}`);
      process.exit(1);
    }
  }
  const { chains } = walletChains("x402-traffic", WALLET_ENV);
  if (chains.length === 0) {
    console.error(`No enabled chain has an oracle W3S wallet (${WALLET_ENV}[_BASE|_ARBITRUM]).`);
    process.exit(1);
  }
  const address = getOracleAddress();

  console.log(`Driving ${COUNT} nanopayments from ${address} → ${BASE} across ${chains.join(", ")}\n`);

  let ok = 0;
  let totalUsd = 0;
  const perChain = new Map<ChainKey, number>();
  const t0 = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const chain = chains[i % chains.length];
    const agent = payingAgentFor(WALLET_ENV, address, chain);
    // ~1 in 5 is a (slower, LLM-backed) council reasoning read; rest are prices.
    const isReasoning = i % 5 === 4;
    const url = isReasoning ? reasoningUrl(i, chain) : priceUrl(i);
    try {
      if (!agent) throw new Error(`no oracle wallet for ${chain}`);
      const { response, payment } = await fetchWithBudget(url, agent, BUDGET);
      if (response.ok && payment) {
        ok++;
        const usd = Number(payment.priceAtomic) / 1e6;
        totalUsd += usd;
        perChain.set(chain, (perChain.get(chain) ?? 0) + 1);
        process.stdout.write(`✓ #${i + 1} [${chain}] ${isReasoning ? "reasoning" : "price"} $${usd.toFixed(6)}\n`);
      } else {
        process.stdout.write(`✗ #${i + 1} [${chain}] HTTP ${response.status}\n`);
      }
    } catch (err) {
      process.stdout.write(`✗ #${i + 1} [${chain}] ${err instanceof Error ? err.message : "error"}\n`);
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const split = [...perChain.entries()].map(([c, n]) => `${c}=${n}`).join(" ");
  console.log(`\n${ok}/${COUNT} paid · $${totalUsd.toFixed(6)} USDC flowed · ${secs}s${split ? ` · ${split}` : ""}`);
  console.log(`See it live at ${BASE.replace(/\/$/, "")}/revenue`);
}

main().catch((err) => {
  console.error("[x402-traffic] FAILED:", err?.message ?? err);
  process.exit(1);
});
