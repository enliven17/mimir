/**
 * Seed today's live-event markets, signed via Circle W3S (no local key).
 * Edit SEEDS with current fixtures/prices, then:
 *
 *   DRY_RUN=1 npx tsx --env-file=.env.local scripts/seed-today.ts   # preview
 *   npx tsx --env-file=.env.local scripts/seed-today.ts             # create
 *
 * Sports deadlines are ABSOLUTE kickoff times (betting closes at kickoff);
 * seeds whose deadline is already within 10 minutes are skipped.
 */

import { formatEther } from "viem";
import {
  createArcPublicClient,
  getContractAddress,
  getExplorerTxUrl,
  usdcToWei,
  weiToUsdc,
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
  a: string;
  b: string;
  url: string;
  category: string;
  rule: string;
  /** Absolute deadline, ISO UTC. */
  deadlineIso: string;
}

const ESPN_WC = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_MLB = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard";

// Fixtures verified against the ESPN API on 2026-07-09; crypto thresholds set
// ~5-10% away from CoinGecko spot the same day. CoinGecko URLs must use API
// ids (ripple, the-open-network, avalanche-2), not web slugs.
const SEEDS: Seed[] = [
  // ── World Cup ──────────────────────────────────────────────────────────────
  {
    question: "Will France beat Morocco in their World Cup semifinal on July 9th, 2026?",
    a: "Yes - France wins the semifinal",
    b: "No - Morocco wins or the match is drawn",
    url: `${ESPN_WC}?dates=20260709`,
    category: "sports",
    rule: "Resolve YES if France is the winner of the France vs Morocco match at full time (including extra time and penalties) per the ESPN scoreboard.",
    deadlineIso: "2026-07-09T20:00:00Z",
  },
  {
    question: "Will the France vs Morocco World Cup semifinal go to extra time on July 9th, 2026?",
    a: "Yes - tied after 90 minutes, extra time played",
    b: "No - decided in regular time",
    url: `${ESPN_WC}?dates=20260709`,
    category: "sports",
    rule: "Resolve YES if the France vs Morocco semifinal is level after 90 minutes and goes to extra time per the ESPN scoreboard.",
    deadlineIso: "2026-07-09T20:00:00Z",
  },
  {
    question: "Will Spain beat Belgium in their World Cup semifinal on July 10th, 2026?",
    a: "Yes - Spain wins the semifinal",
    b: "No - Belgium wins or the match is drawn",
    url: `${ESPN_WC}?dates=20260710`,
    category: "sports",
    rule: "Resolve YES if Spain is the winner of the Spain vs Belgium match at full time (including extra time and penalties) per the ESPN scoreboard.",
    deadlineIso: "2026-07-10T19:00:00Z",
  },
  // ── MLB (today) ────────────────────────────────────────────────────────────
  {
    question: "Will the New York Yankees beat the Tampa Bay Rays on July 9th, 2026?",
    a: "Yes - Yankees win",
    b: "No - Rays win",
    url: `${ESPN_MLB}?dates=20260709`,
    category: "sports",
    rule: "Resolve YES if the Yankees win the July 9, 2026 game vs the Rays per the ESPN MLB scoreboard.",
    deadlineIso: "2026-07-09T17:10:00Z",
  },
  {
    question: "Will the Seattle Mariners beat the Miami Marlins on July 9th, 2026?",
    a: "Yes - Mariners win",
    b: "No - Marlins win",
    url: `${ESPN_MLB}?dates=20260709`,
    category: "sports",
    rule: "Resolve YES if the Mariners win the July 9, 2026 game vs the Marlins per the ESPN MLB scoreboard.",
    deadlineIso: "2026-07-09T22:40:00Z",
  },
  {
    question: "Will the Philadelphia Phillies beat the Cincinnati Reds on July 9th, 2026?",
    a: "Yes - Phillies win",
    b: "No - Reds win",
    url: `${ESPN_MLB}?dates=20260709`,
    category: "sports",
    rule: "Resolve YES if the Phillies win the July 9, 2026 game vs the Reds per the ESPN MLB scoreboard.",
    deadlineIso: "2026-07-09T23:10:00Z",
  },
  // ── Crypto (fresh thresholds vs 2026-07-09 spot) ───────────────────────────
  {
    question: "Will XRP be above $1.15 by July 11th, 2026?",
    a: "Yes, XRP >= $1.15",
    b: "No, XRP < $1.15",
    url: "https://www.coingecko.com/en/coins/ripple",
    category: "crypto",
    rule: "CoinGecko XRP/USD spot at the deadline.",
    deadlineIso: "2026-07-11T15:00:00Z",
  },
  {
    question: "Will Chainlink (LINK) be above $8.25 by July 11th, 2026?",
    a: "Yes, LINK >= $8.25",
    b: "No, LINK < $8.25",
    url: "https://www.coingecko.com/en/coins/chainlink",
    category: "crypto",
    rule: "CoinGecko LINK/USD spot at the deadline.",
    deadlineIso: "2026-07-11T15:00:00Z",
  },
  {
    question: "Will Toncoin (TON) be above $1.70 by July 11th, 2026?",
    a: "Yes, TON >= $1.70",
    b: "No, TON < $1.70",
    url: "https://www.coingecko.com/en/coins/the-open-network",
    category: "crypto",
    rule: "CoinGecko TON/USD spot at the deadline.",
    deadlineIso: "2026-07-11T15:00:00Z",
  },
  {
    question: "Will Cardano (ADA) be above $0.18 by July 11th, 2026?",
    a: "Yes, ADA >= $0.18",
    b: "No, ADA < $0.18",
    url: "https://www.coingecko.com/en/coins/cardano",
    category: "crypto",
    rule: "CoinGecko ADA/USD spot at the deadline.",
    deadlineIso: "2026-07-11T15:00:00Z",
  },
  {
    question: "Will Bitcoin (BTC) be above $65,000 by July 11th, 2026?",
    a: "Yes, BTC >= $65,000",
    b: "No, BTC < $65,000",
    url: "https://www.coingecko.com/en/coins/bitcoin",
    category: "crypto",
    rule: "CoinGecko BTC/USD spot at the deadline.",
    deadlineIso: "2026-07-11T15:00:00Z",
  },
  {
    question: "Will Solana (SOL) be above $82.00 by July 11th, 2026?",
    a: "Yes, SOL >= $82",
    b: "No, SOL < $82",
    url: "https://www.coingecko.com/en/coins/solana",
    category: "crypto",
    rule: "CoinGecko SOL/USD spot at the deadline.",
    deadlineIso: "2026-07-11T15:00:00Z",
  },
  {
    question: "Will Hyperliquid (HYPE) be above $72.00 by July 11th, 2026?",
    a: "Yes, HYPE >= $72",
    b: "No, HYPE < $72",
    url: "https://www.coingecko.com/en/coins/hyperliquid",
    category: "crypto",
    rule: "CoinGecko HYPE/USD spot at the deadline.",
    deadlineIso: "2026-07-11T15:00:00Z",
  },
  // ── Weather ────────────────────────────────────────────────────────────────
  {
    question: "Will it rain in Istanbul on July 9th, 2026?",
    a: "Yes - measurable rain in Istanbul today",
    b: "No - dry day in Istanbul",
    url: "https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.97&daily=precipitation_sum&past_days=1&timezone=UTC",
    category: "weather",
    rule: "Resolve YES if Open-Meteo reports precipitation_sum above 0.2mm for Istanbul on 2026-07-09 (UTC).",
    deadlineIso: "2026-07-09T21:00:00Z",
  },
  {
    question: "Will Dubai exceed 40°C on July 10th, 2026?",
    a: "Yes - Dubai max temperature above 40°C",
    b: "No - stays at or below 40°C",
    url: "https://api.open-meteo.com/v1/forecast?latitude=25.20&longitude=55.27&daily=temperature_2m_max&past_days=1&timezone=UTC",
    category: "weather",
    rule: "Resolve YES if Open-Meteo reports temperature_2m_max above 40.0°C for Dubai on 2026-07-10 (UTC).",
    deadlineIso: "2026-07-10T15:00:00Z",
  },
];

const MIN_LEAD_MS = 10 * 60 * 1000;

async function main() {
  const wallet = getMarketCreatorWalletId();
  const addr = getMarketCreatorAddress();
  const pub = createArcPublicClient();
  const stake = usdcToWei(STAKE_USDC);
  const now = Date.now();

  const live = SEEDS.filter((s) => new Date(s.deadlineIso).getTime() - now > MIN_LEAD_MS);
  const skipped = SEEDS.length - live.length;

  console.log(`Seeding ${live.length} claims on ${CONTRACT}${skipped ? ` (${skipped} skipped — deadline too close/past)` : ""}`);
  console.log(`Creator (W3S): ${addr} · now ${new Date(now).toISOString()}`);
  const bal = await pub.getBalance({ address: addr });
  console.log(`Balance: ${weiToUsdc(bal).toFixed(2)} USDC · need ~${(live.length * STAKE_USDC).toFixed(0)} + gas\n`);
  if (!DRY_RUN && bal < stake * BigInt(live.length + 2)) {
    throw new Error("Insufficient creator balance — top up via faucet.circle.com");
  }

  let created = 0;
  for (const s of live) {
    const deadline = BigInt(Math.floor(new Date(s.deadlineIso).getTime() / 1000));
    console.log(`→ [${s.category}] "${s.question.slice(0, 64)}…" (deadline ${s.deadlineIso})`);
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
        refId: `seed-today-${created}`,
      });
      created++;
      console.log(`  ✓ ${getExplorerTxUrl(tx)}`);
    } catch (err) {
      console.error(`  ✗ ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nDone — ${created}/${live.length} claim${created === 1 ? "" : "s"} created.`);
}

main().catch((err) => { console.error("seed failed:", err?.message ?? err); process.exit(1); });
