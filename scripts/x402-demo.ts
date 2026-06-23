/**
 * x402 end-to-end demo — one Mimir agent BUYS data from another over HTTP 402.
 *
 *   oracle wallet  ──$0.001 USDC──►  /api/premium/price  (seller: X402_SELLER_ADDRESS)
 *
 * Proves the full nanopayment loop: probe price → budget check → W3S-signed
 * payment → Circle Gateway settlement → paid content. This is the agent-to-agent
 * economy (RFB #1 buyer + #2 seller) running on real testnet USDC.
 *
 * Run (with the app serving locally or a deployed URL):
 *   npm run dev                       # in one terminal
 *   npm run x402:demo                 # in another
 *   X402_TARGET=https://your.app npm run x402:demo   # against prod
 *
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_ORACLE_WALLET_ID,
 *      CIRCLE_ORACLE_ADDRESS  (the buyer signs via W3S — no local key)
 */

import { fetchWithBudget, usdcToAtomic } from "../lib/x402";
import { getOracleWalletId, getOracleAddress } from "../lib/circle-w3s";

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

async function main(): Promise<void> {
  for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_ORACLE_WALLET_ID", "CIRCLE_ORACLE_ADDRESS"]) {
    if (!process.env[v]) {
      console.error(`Missing env: ${v}`);
      process.exit(1);
    }
  }

  const agent = { walletId: getOracleWalletId(), address: getOracleAddress() };
  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir x402 demo — buying premium data");
  console.log(`  Buyer (oracle): ${agent.address}`);
  console.log(`  Target        : ${URL}`);
  console.log(`  Budget cap    : ${Number(BUDGET) / 1e6} USDC`);
  console.log("═══════════════════════════════════════════════\n");

  const t0 = Date.now();
  const { response, payment } = await fetchWithBudget(URL, agent, BUDGET);
  const ms = Date.now() - t0;

  if (payment) {
    console.log(`💸 Paid ${Number(payment.priceAtomic) / 1e6} ${payment.asset} in ${ms}ms`);
    if (payment.settlement) console.log("   settlement:", JSON.stringify(payment.settlement));
  } else {
    console.log(`(no payment required — endpoint was free, ${ms}ms)`);
  }

  const text = await response.text();
  console.log(`\nHTTP ${response.status}`);
  console.log(text.slice(0, 800));

  if (!response.ok) process.exit(1);
}

main().catch((err) => {
  console.error("\n[x402-demo] FAILED:", err?.message ?? err);
  process.exit(1);
});
