/**
 * W3S seed — create demo claims on the current contract, signed via Circle W3S
 * (no local private key). Use after deploying a fresh contract.
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-w3s.ts
 *   DRY_RUN=1 to preview without sending.
 */

import { formatEther } from "viem";
import {
  createArcPublicClient,
  getContractAddress,
  getExplorerTxUrl,
  usdcToMicro,
  microToUsdc,
} from "../lib/arc";
import { MIMIR_ABI } from "../lib/mimir-abi";
import {
  executeContract,
  buildAbiFunctionSignature,
  toCircleAbiParameters,
  getMarketCreatorWalletId,
  getMarketCreatorAddress,
} from "../lib/circle-w3s";

const DRY_RUN = process.env.DRY_RUN === "1";
const STAKE_USDC = 2;
const CONTRACT = getContractAddress();
const SIG_CREATE = buildAbiFunctionSignature("createClaim", MIMIR_ABI);

interface Seed {
  question: string;
  a: string; // creator position
  b: string; // counter position
  url: string;
  category: string;
  rule: string;
  hours: number;
}

// Deterministic, near-term, resolvable claims across categories.
const SEEDS: Seed[] = [
  { question: "Will BTC be above $40,000 at the deadline?", a: "Yes, BTC ≥ $40k", b: "No, BTC < $40k", url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", category: "crypto", rule: "CoinGecko BTC/USD spot at deadline.", hours: 6 },
  { question: "Will ETH be above $2,000 at the deadline?", a: "Yes, ETH ≥ $2k", b: "No, ETH < $2k", url: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", category: "crypto", rule: "CoinGecko ETH/USD spot at deadline.", hours: 6 },
  { question: "Will SOL be above $100 at the deadline?", a: "Yes, SOL ≥ $100", b: "No, SOL < $100", url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", category: "crypto", rule: "CoinGecko SOL/USD spot at deadline.", hours: 12 },
  { question: "Will USDC hold its $1.00 peg (≥ $0.999) at the deadline?", a: "Yes, peg holds", b: "No, depeg below $0.999", url: "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd", category: "defi", rule: "CoinGecko USDC/USD spot at deadline.", hours: 24 },
  { question: "Will BNB be above $500 at the deadline?", a: "Yes, BNB ≥ $500", b: "No, BNB < $500", url: "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd", category: "crypto", rule: "CoinGecko BNB/USD spot at deadline.", hours: 24 },
  { question: "Will the total crypto market cap be above $2T at the deadline?", a: "Yes, ≥ $2T", b: "No, < $2T", url: "https://api.coingecko.com/api/v3/global", category: "crypto", rule: "CoinGecko global total_market_cap.usd at deadline.", hours: 48 },
  { question: "Will DOGE be above $0.10 at the deadline?", a: "Yes, DOGE ≥ $0.10", b: "No, DOGE < $0.10", url: "https://api.coingecko.com/api/v3/simple/price?ids=dogecoin&vs_currencies=usd", category: "crypto", rule: "CoinGecko DOGE/USD spot at deadline.", hours: 48 },
  { question: "Will AVAX be above $30 at the deadline?", a: "Yes, AVAX ≥ $30", b: "No, AVAX < $30", url: "https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd", category: "crypto", rule: "CoinGecko AVAX/USD spot at deadline.", hours: 72 },
];

async function main() {
  const wallet = getMarketCreatorWalletId();
  const addr = getMarketCreatorAddress();
  const pub = createArcPublicClient();
  const stake = usdcToMicro(STAKE_USDC);

  console.log(`Seeding ${SEEDS.length} claims on ${CONTRACT}`);
  console.log(`Creator (W3S): ${addr}`);
  const bal = await pub.getBalance({ address: addr });
  console.log(`Balance: ${microToUsdc(bal).toFixed(2)} USDC · need ~${(SEEDS.length * STAKE_USDC).toFixed(0)} + gas\n`);
  if (!DRY_RUN && bal < stake * BigInt(SEEDS.length + 2)) {
    throw new Error("Insufficient creator balance — top up via faucet.circle.com");
  }

  let created = 0;
  for (const s of SEEDS) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + s.hours * 3600);
    console.log(`→ "${s.question.slice(0, 50)}…" (${s.category}, ${s.hours}h)`);
    if (DRY_RUN) { created++; continue; }
    try {
      const tx = await executeContract({
        walletId: wallet,
        contractAddress: CONTRACT,
        abiFunctionSignature: SIG_CREATE,
        abiParameters: toCircleAbiParameters([
          s.question, s.a, s.b, s.url, deadline, stake, s.category,
          BigInt(0), "binary", "pool", BigInt(0), "", s.rule, BigInt(100), false, "",
        ]),
        amount: formatEther(stake),
        refId: `seed-${Date.now()}`,
      });
      created++;
      console.log(`  ✓ ${getExplorerTxUrl(tx)}`);
    } catch (err) {
      console.error(`  ✗ ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nDone — ${created}/${SEEDS.length} claim${created === 1 ? "" : "s"} created.`);
}

main().catch((err) => { console.error("seed failed:", err?.message ?? err); process.exit(1); });
