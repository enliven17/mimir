/**
 * x402 end-to-end demo — one Mimir agent BUYS data from another over HTTP 402.
 *
 *   oracle wallet  ──$0.001 USDC──►  /api/premium/price  (seller: X402_SELLER_ADDRESS)
 *
 * Proves the full nanopayment loop: probe price → budget check → W3S-signed
 * payment → Circle Gateway settlement → paid content. This is the agent-to-agent
 * economy (RFB #1 buyer + #2 seller) running on real testnet USDC.
 *
 * Multichain: buys once per enabled chain where the oracle has a W3S wallet,
 * preferring that chain's network each time, so one run shows the same
 * purchase settling on Arc, Base and Arbitrum. X402_CHAIN=<key> buys on one.
 *
 * Run (with the app serving locally or a deployed URL):
 *   npm run dev                       # in one terminal
 *   npm run x402:demo                 # in another
 *   X402_TARGET=https://your.app npm run x402:demo   # against prod
 *
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_ORACLE_ADDRESS,
 *      CIRCLE_ORACLE_WALLET_ID[_BASE|_ARBITRUM]  (the buyer signs via W3S — no local key)
 */

import { fetchWithBudget, usdcToAtomic } from "../lib/x402";
import { getOracleAddress } from "../lib/circle-w3s";
import { getChain, isChainKey, type ChainKey } from "../lib/chains";
import { payingAgentFor, walletChains } from "../agents/shared/chains";

const BASE = process.env.X402_TARGET ?? "http://localhost:3000";
const SYMBOL = process.env.X402_SYMBOL ?? "bitcoin";
// X402_URL overrides the default premium-price target (path or absolute URL).
const RAW = process.env.X402_URL;
const URL = RAW
  ? RAW.startsWith("http")
    ? RAW
    : `${BASE}${RAW}`
  : `${BASE}/api/premium/price?symbol=${encodeURIComponent(SYMBOL)}`;

// The buyer is willing to spend up to 1 cent on this call.
const BUDGET = usdcToAtomic(0.01);
const WALLET_ENV = "CIRCLE_ORACLE_WALLET_ID";

function demoChains(): ChainKey[] {
  const { chains } = walletChains("x402-demo", WALLET_ENV);
  const only = process.env.X402_CHAIN?.trim().toLowerCase();
  return isChainKey(only) ? chains.filter((c) => c === only) : chains;
}

/** One paid purchase preferring `chain`. Returns false on a non-2xx. */
async function buyOn(chain: ChainKey, address: `0x${string}`): Promise<boolean> {
  const agent = payingAgentFor(WALLET_ENV, address, chain);
  if (!agent) throw new Error(`no oracle wallet for ${chain}`);
  const tag = `[x402-demo][${chain}]`;

  const t0 = Date.now();
  const { response, payment } = await fetchWithBudget(URL, agent, BUDGET);
  const ms = Date.now() - t0;

  if (payment) {
    console.log(`${tag} 💸 Paid ${Number(payment.priceAtomic) / 1e6} ${payment.asset} in ${ms}ms (prefer ${getChain(chain).name})`);
    if (payment.settlement) console.log(`${tag}    settlement:`, JSON.stringify(payment.settlement));
  } else {
    console.log(`${tag} (no payment required — endpoint was free, ${ms}ms)`);
  }

  const text = await response.text();
  console.log(`${tag} HTTP ${response.status}`);
  console.log(text.slice(0, 800));
  return response.ok;
}

async function main(): Promise<void> {
  for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_ORACLE_ADDRESS"]) {
    if (!process.env[v]) {
      console.error(`Missing env: ${v}`);
      process.exit(1);
    }
  }
  const chains = demoChains();
  if (chains.length === 0) {
    console.error(`No enabled chain has an oracle W3S wallet (${WALLET_ENV}[_BASE|_ARBITRUM]).`);
    process.exit(1);
  }

  const address = getOracleAddress();
  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir x402 demo — buying premium data");
  console.log(`  Buyer (oracle): ${address}`);
  console.log(`  Target        : ${URL}`);
  console.log(`  Networks      : ${chains.join(", ")}`);
  console.log(`  Budget cap    : ${Number(BUDGET) / 1e6} USDC per call`);
  console.log("═══════════════════════════════════════════════\n");

  let failed = 0;
  for (const chain of chains) {
    try {
      if (!(await buyOn(chain, address))) failed++;
    } catch (err) {
      failed++;
      console.error(`[x402-demo][${chain}] FAILED:`, err instanceof Error ? err.message : err);
    }
    console.log("");
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n[x402-demo] FAILED:", err?.message ?? err);
  process.exit(1);
});
