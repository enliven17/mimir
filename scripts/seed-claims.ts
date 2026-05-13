/**
 * Seed Claims Script — Creates 15 demo claims across all categories
 *
 * These claims are designed to be immediately resolvable by the oracle agent,
 * demonstrating real traction on Arc Testnet for the hackathon.
 *
 * Run AFTER deploying the contract:
 *   DEPLOYER_PRIVATE_KEY=0x... npx tsx scripts/seed-claims.ts
 *
 * Or dry-run (no transactions):
 *   DRY_RUN=1 npx tsx scripts/seed-claims.ts
 */

import {
  createArcPublicClient,
  createArcWalletClientWithKey,
  arcTestnet,
  getContractAddress,
  getExplorerTxUrl,
  usdcToMicro,
  microToUsdc,
} from "../lib/arc";
import { MIMIR_ABI } from "../lib/mimir-abi";

const CONTRACT_ADDRESS    = getContractAddress();
const PRIVATE_KEY         = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`;
const DRY_RUN             = process.env.DRY_RUN === "1";
const STAKE_USDC          = 2;
const SHORT_DEADLINE_SECS = 3600;      // 1h — for claims that resolve immediately
const MED_DEADLINE_SECS   = 86400;     // 24h
const LONG_DEADLINE_SECS  = 604800;    // 7d

if (!PRIVATE_KEY && !DRY_RUN) {
  console.error("DEPLOYER_PRIVATE_KEY is required. Use DRY_RUN=1 to preview.");
  process.exit(1);
}

// ── Claim definitions ─────────────────────────────────────────────────────────
interface SeedClaim {
  question:        string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl:   string;
  category:        string;
  settlementRule:  string;
  deadlineSecs:    number;
  label:           string;
}

function deadlineAt(secs: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + secs);
}

const SEED_CLAIMS: SeedClaim[] = [
  // ── CRYPTO (5 claims) ─────────────────────────────────────────────────────
  {
    label: "BTC price threshold",
    question: "Will Bitcoin (BTC) be above $95,000 USD at the end of today (UTC midnight)?",
    creatorPosition: "Yes — BTC stays above $95k today",
    counterPosition: "No — BTC drops below $95k today",
    resolutionUrl: "https://www.coingecko.com/en/coins/bitcoin",
    category: "crypto",
    settlementRule: "Resolve YES if the CoinGecko price for Bitcoin is ≥ $95,000 at UTC midnight on the deadline date.",
    deadlineSecs: SHORT_DEADLINE_SECS,
  },
  {
    label: "ETH price threshold",
    question: "Will Ethereum (ETH) be above $3,000 USD in the next 24 hours?",
    creatorPosition: "Yes — ETH holds above $3k",
    counterPosition: "No — ETH falls below $3k",
    resolutionUrl: "https://www.coingecko.com/en/coins/ethereum",
    category: "crypto",
    settlementRule: "Resolve YES if ETH price on CoinGecko is ≥ $3,000 at the deadline.",
    deadlineSecs: MED_DEADLINE_SECS,
  },
  {
    label: "BTC market cap #1",
    question: "Will Bitcoin maintain the #1 market cap ranking for the next 7 days?",
    creatorPosition: "Yes — Bitcoin stays #1",
    counterPosition: "No — another asset overtakes Bitcoin",
    resolutionUrl: "https://coinmarketcap.com/",
    category: "crypto",
    settlementRule: "Resolve YES if Bitcoin is ranked #1 by market cap on CoinMarketCap at the deadline.",
    deadlineSecs: LONG_DEADLINE_SECS,
  },
  {
    label: "Crypto total market cap",
    question: "Will global crypto market cap exceed $3 trillion this week?",
    creatorPosition: "Yes — market cap breaks $3T",
    counterPosition: "No — stays below $3T",
    resolutionUrl: "https://www.coingecko.com/en/global-charts",
    category: "crypto",
    settlementRule: "Resolve YES if CoinGecko global market cap exceeds $3,000,000,000,000 at any point before deadline.",
    deadlineSecs: LONG_DEADLINE_SECS,
  },
  {
    label: "SOL price",
    question: "Will Solana (SOL) be above $170 USD at the end of this week?",
    creatorPosition: "Yes — SOL closes above $170",
    counterPosition: "No — SOL closes below $170",
    resolutionUrl: "https://www.coingecko.com/en/coins/solana",
    category: "crypto",
    settlementRule: "Resolve YES if SOL price on CoinGecko is ≥ $170 at the deadline.",
    deadlineSecs: LONG_DEADLINE_SECS,
  },

  // ── SPORTS (5 claims) ─────────────────────────────────────────────────────
  {
    label: "NBA playoff game",
    question: "Will the team with home court advantage win in the next NBA playoff game?",
    creatorPosition: "Yes — home court wins",
    counterPosition: "No — away team wins",
    resolutionUrl: "https://www.espn.com/nba/scoreboard",
    category: "sports",
    settlementRule: "Resolve YES if the home team wins the next scheduled NBA playoff game on ESPN scoreboard.",
    deadlineSecs: MED_DEADLINE_SECS,
  },
  {
    label: "Sports total score over/under",
    question: "Will the next NBA game have a combined score over 220 points?",
    creatorPosition: "Yes — over 220 combined",
    counterPosition: "No — under 220 combined",
    resolutionUrl: "https://www.espn.com/nba/scoreboard",
    category: "sports",
    settlementRule: "Resolve YES if total combined points in the next NBA game on ESPN exceeds 220.",
    deadlineSecs: MED_DEADLINE_SECS,
  },
  {
    label: "Soccer match result",
    question: "Will the next Premier League match end in a draw?",
    creatorPosition: "Yes — it's a draw",
    counterPosition: "No — one team wins",
    resolutionUrl: "https://www.bbc.com/sport/football/scores-fixtures",
    category: "sports",
    settlementRule: "Resolve YES if the next Premier League game listed on BBC Sport ends level (equal score) at full time.",
    deadlineSecs: MED_DEADLINE_SECS,
  },
  {
    label: "UFC winner bet",
    question: "Will the next UFC main event be decided by knockout or TKO?",
    creatorPosition: "Yes — KO/TKO finish",
    counterPosition: "No — decision or submission",
    resolutionUrl: "https://www.ufc.com/events",
    category: "sports",
    settlementRule: "Resolve YES if the next UFC main event ends via KO or TKO per the official UFC event page.",
    deadlineSecs: LONG_DEADLINE_SECS,
  },
  {
    label: "Tennis Grand Slam",
    question: "Will the top seed win the next tennis Grand Slam final?",
    creatorPosition: "Yes — top seed wins",
    counterPosition: "No — upset victory",
    resolutionUrl: "https://www.atptour.com/en/scores/current",
    category: "sports",
    settlementRule: "Resolve YES if the #1 ranked player wins the next ATP Grand Slam final per the ATP Tour results page.",
    deadlineSecs: LONG_DEADLINE_SECS,
  },

  // ── WEATHER (2 claims) ─────────────────────────────────────────────────────
  {
    label: "NYC weather",
    question: "Will New York City temperature exceed 25°C (77°F) tomorrow?",
    creatorPosition: "Yes — NYC exceeds 25°C tomorrow",
    counterPosition: "No — stays at or below 25°C",
    resolutionUrl: "https://forecast.weather.gov/MapClick.php?CityName=New+York&state=NY&site=OKX",
    category: "weather",
    settlementRule: "Resolve YES if the NWS forecast high temperature for NYC tomorrow is above 25°C / 77°F.",
    deadlineSecs: MED_DEADLINE_SECS,
  },
  {
    label: "London rain",
    question: "Will it rain in London tomorrow according to the official UK Met Office forecast?",
    creatorPosition: "Yes — rain in London tomorrow",
    counterPosition: "No — dry day in London",
    resolutionUrl: "https://www.metoffice.gov.uk/weather/forecast/gcpvj0v07",
    category: "weather",
    settlementRule: "Resolve YES if the Met Office forecast for London tomorrow shows any precipitation probability above 50%.",
    deadlineSecs: MED_DEADLINE_SECS,
  },

  // ── CULTURE (3 claims) ────────────────────────────────────────────────────
  {
    label: "Box office #1",
    question: "Will the current #1 box office movie retain its top spot next weekend?",
    creatorPosition: "Yes — same #1 next weekend",
    counterPosition: "No — a new movie takes #1",
    resolutionUrl: "https://www.boxofficemojo.com/weekend/",
    category: "culture",
    settlementRule: "Resolve YES if the same movie ranked #1 this weekend retains the #1 position next weekend on Box Office Mojo.",
    deadlineSecs: LONG_DEADLINE_SECS,
  },
  {
    label: "Spotify #1",
    question: "Will the current Spotify Global #1 song remain #1 for 7 more days?",
    creatorPosition: "Yes — same song stays #1",
    counterPosition: "No — dethroned within 7 days",
    resolutionUrl: "https://charts.spotify.com/charts/view/regional-global-weekly/latest",
    category: "culture",
    settlementRule: "Resolve YES if the same song holds the #1 position on Spotify Global Weekly chart at the deadline.",
    deadlineSecs: LONG_DEADLINE_SECS,
  },
  {
    label: "Tech announcement",
    question: "Will Apple release a new product announcement this week?",
    creatorPosition: "Yes — Apple announces something new",
    counterPosition: "No — no Apple announcement this week",
    resolutionUrl: "https://www.apple.com/newsroom/",
    category: "culture",
    settlementRule: "Resolve YES if Apple's Newsroom page shows a new product/service announcement published this week (not software updates).",
    deadlineSecs: LONG_DEADLINE_SECS,
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const stake = usdcToMicro(STAKE_USDC);

  if (DRY_RUN) {
    console.log("═══════════════════════════════════════════════");
    console.log("  Mimir Seed Claims — DRY RUN");
    console.log(`  ${SEED_CLAIMS.length} claims would be created`);
    console.log(`  Each stake: ${STAKE_USDC} USDC`);
    console.log(`  Total USDC needed: ~${SEED_CLAIMS.length * STAKE_USDC} USDC`);
    console.log("═══════════════════════════════════════════════\n");
    SEED_CLAIMS.forEach((c, i) => {
      console.log(`${i + 1}. [${c.category.toUpperCase()}] ${c.label}`);
      console.log(`   Q: ${c.question.slice(0, 80)}...`);
      console.log(`   URL: ${c.resolutionUrl}`);
      console.log(`   Deadline: ${c.deadlineSecs / 3600}h from now\n`);
    });
    return;
  }

  const publicClient = createArcPublicClient();
  const walletClient = createArcWalletClientWithKey(PRIVATE_KEY);
  const account      = walletClient.account!;
  const balance      = await publicClient.getBalance({ address: account.address });

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Seed Claims");
  console.log(`  Contract : ${CONTRACT_ADDRESS}`);
  console.log(`  Creator  : ${account.address}`);
  console.log(`  Balance  : ${microToUsdc(balance).toFixed(4)} USDC`);
  console.log(`  Claims   : ${SEED_CLAIMS.length}`);
  console.log(`  Stake/ea : ${STAKE_USDC} USDC`);
  console.log(`  Total    : ~${SEED_CLAIMS.length * STAKE_USDC} USDC`);
  console.log("═══════════════════════════════════════════════\n");

  if (balance < stake * BigInt(SEED_CLAIMS.length)) {
    console.error(`Insufficient balance! Need ~${SEED_CLAIMS.length * STAKE_USDC} USDC, have ${microToUsdc(balance).toFixed(2)} USDC`);
    console.error("Get testnet USDC: https://faucet.circle.com");
    process.exit(1);
  }

  let created = 0;
  let failed  = 0;

  for (const [i, seed] of SEED_CLAIMS.entries()) {
    console.log(`[${i + 1}/${SEED_CLAIMS.length}] Creating: ${seed.label}`);
    console.log(`  Q: ${seed.question.slice(0, 70)}...`);

    try {
      const txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: MIMIR_ABI,
        functionName: "createClaim",
        args: [
          seed.question,
          seed.creatorPosition,
          seed.counterPosition,
          seed.resolutionUrl,
          deadlineAt(seed.deadlineSecs),
          stake,
          seed.category,
          BigInt(0),    // parentId
          "binary",     // marketType
          "pool",       // oddsMode
          BigInt(0),    // challengerPayoutBps
          "",           // handicapLine
          seed.settlementRule,
          BigInt(100),  // maxChallengers
          false,        // isPrivate
          "",           // inviteKey
        ],
        value: stake,
        account,
        chain: arcTestnet,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`  ✓ ${getExplorerTxUrl(txHash)}`);
      created++;
    } catch (err: any) {
      console.error(`  ✗ Failed: ${err?.shortMessage ?? err?.message ?? err}`);
      failed++;
    }

    // Small delay to avoid nonce collision
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Done: ${created} created, ${failed} failed`);
  console.log(`  Now run the oracle to auto-settle expired claims:`);
  console.log(`  npm run oracle`);
  console.log(`═══════════════════════════════════════════════`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
