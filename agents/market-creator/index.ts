/**
 * Mimir Market Creator Agent
 *
 * Autonomously creates prediction markets from trusted public sources:
 *   - CoinGecko (crypto prices)
 *   - ESPN Headlines (sports)
 *   - OpenWeather (weather)
 *   - Custom RSS/API feeds
 *
 * Flow:
 *   1. Fetch events from trusted sources
 *   2. Use Claude to draft verifiable claim candidates
 *   3. Score candidates for quality (question clarity, source quality, deadline)
 *   4. Create top-scored claims on-chain via Mimir contract
 *   5. Optionally self-stake creator side (puts skin in the game)
 *
 * Run: npx tsx agents/market-creator/index.ts
 * Env: CREATOR_PRIVATE_KEY, NEXT_PUBLIC_CONTRACT_ADDRESS, ANTHROPIC_API_KEY
 *      CREATOR_STAKE_USDC=2      (stake per market, default 2 USDC)
 *      MAX_CLAIMS_PER_RUN=5      (max new claims per run, default 5)
 *      RUN_INTERVAL_HOURS=6      (hours between runs, default 6h)
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  createArcPublicClient,
  arcTestnet,
  getContractAddress,
  getExplorerTxUrl,
  usdcToMicro,
  microToUsdc,
} from "../../lib/arc";
import {
  executeContract,
  buildAbiFunctionSignature,
  toCircleAbiParameters,
  getMarketCreatorWalletId,
  getMarketCreatorAddress,
} from "../../lib/circle-w3s";
import { MIMIR_ABI } from "../../lib/mimir-abi";

// ── Config ────────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS    = getContractAddress();
const CREATOR_STAKE_USDC  = Number(process.env.CREATOR_STAKE_USDC ?? "2");
const MAX_CLAIMS_PER_RUN  = Number(process.env.MAX_CLAIMS_PER_RUN ?? "5");
const RUN_INTERVAL_HOURS  = Number(process.env.RUN_INTERVAL_HOURS ?? "6");
const MIN_QUALITY_SCORE   = 70; // 0-100

for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_CREATOR_WALLET_ID", "CIRCLE_CREATOR_ADDRESS", "ANTHROPIC_API_KEY"]) {
  if (!process.env[v]) {
    console.error(`${v} env var is required`);
    process.exit(1);
  }
}

const SIG_CREATE_CLAIM = buildAbiFunctionSignature("createClaim", MIMIR_ABI);

// ── Clients ───────────────────────────────────────────────────────────────────
const publicClient   = createArcPublicClient();
const CREATOR_WALLET = getMarketCreatorWalletId();
const CREATOR_ADDR   = getMarketCreatorAddress();
const anthropic      = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────
interface ClaimCandidate {
  question:         string;
  creatorPosition:  string;
  counterPosition:  string;
  resolutionUrl:    string;
  category:         string;
  marketType:       string;
  settlementRule:   string;
  deadlineHours:    number;
  qualityScore:     number;
  sourceType:       string;
}

// ── Source fetchers ───────────────────────────────────────────────────────────

async function fetchCryptoEvents(): Promise<string> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&sparkline=false",
      { headers: { "User-Agent": "Mimir-MarketCreator/1.0" } }
    );
    const coins = await res.json() as any[];
    return coins.map((c: any) =>
      `${c.name} (${c.symbol.toUpperCase()}): $${c.current_price.toFixed(2)}, 24h change: ${c.price_change_percentage_24h?.toFixed(1)}%, market cap: $${(c.market_cap / 1e9).toFixed(1)}B`
    ).join("\n");
  } catch {
    return "BTC: ~$95,000, ETH: ~$3,500, SOL: ~$180 (live data unavailable)";
  }
}

async function fetchSportsEvents(): Promise<string> {
  try {
    // ESPN's public API for upcoming events (no key required for basic data)
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      { headers: { "User-Agent": "Mimir-MarketCreator/1.0" } }
    );
    const data = await res.json() as any;
    const events = (data.events ?? []).slice(0, 5);
    if (events.length === 0) return "No current NBA events found";
    return events.map((e: any) => {
      const comps = e.competitions?.[0]?.competitors ?? [];
      const teams = comps.map((c: any) => `${c.team.displayName} (${c.score ?? "?"})}`).join(" vs ");
      return `${e.name}: ${teams} — ${e.status?.type?.description ?? "scheduled"}`;
    }).join("\n");
  } catch {
    return "Sports data temporarily unavailable";
  }
}

async function fetchWeatherEvents(): Promise<string> {
  // Simple approach: predict temperature/weather for major cities
  const cities = ["New York", "London", "Tokyo", "Sydney", "Dubai"];
  const selected = cities[Math.floor(Math.random() * cities.length)];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split("T")[0];
  return `Weather prediction opportunity: ${selected} on ${dateStr}. Use weather.gov or open-meteo.com for resolution.`;
}

// ── Claude drafts claims ──────────────────────────────────────────────────────

async function draftClaimCandidates(sourceData: {
  crypto: string;
  sports: string;
  weather: string;
}): Promise<ClaimCandidate[]> {
  const now     = new Date();
  const prompt  = `You are Mimir, an AI that creates high-quality prediction market claims for a USDC market on Arc blockchain.

## Current Data Sources

### Crypto Markets (from CoinGecko)
${sourceData.crypto}

### Sports Events (from ESPN)
${sourceData.sports}

### Weather Opportunity
${sourceData.weather}

## Task
Create ${MAX_CLAIMS_PER_RUN} prediction market claim candidates. Each must be:
- **Verifiable**: resolvable from a specific public URL
- **Binary or near-binary**: clear winner/loser outcome
- **Time-bounded**: deadline between 2-72 hours from now (${now.toISOString()})
- **Specific**: no vague language like "probably" or "might"

For each candidate, provide:
{
  "question": "Will [specific thing] happen by [specific date/time]?",
  "creatorPosition": "Yes — [brief reason]",
  "counterPosition": "No — [brief reason]",
  "resolutionUrl": "https://...",  // exact URL
  "category": "crypto" | "sports" | "weather" | "culture",
  "marketType": "binary",
  "settlementRule": "Resolve YES if [exact condition] at the resolution URL at deadline.",
  "deadlineHours": <2-72>,
  "qualityScore": <0-100>,  // your confidence this claim is clear and verifiable
  "sourceType": "coingecko" | "espn" | "weather" | "custom"
}

Return a JSON array of ${MAX_CLAIMS_PER_RUN} candidates. Output JSON only.`;

  const message = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 2000,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = (message.content[0] as any)?.text ?? "";
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array in response");
    const candidates = JSON.parse(jsonMatch[0]) as ClaimCandidate[];
    return candidates.filter((c) => c.qualityScore >= MIN_QUALITY_SCORE);
  } catch (err) {
    console.warn("[market-creator] Failed to parse candidates:", err);
    return [];
  }
}

// ── Create claim on-chain ─────────────────────────────────────────────────────

async function createClaim(candidate: ClaimCandidate): Promise<string | null> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + candidate.deadlineHours * 3600);
  const stake    = usdcToMicro(CREATOR_STAKE_USDC);

  // Check balance
  const balance = await publicClient.getBalance({ address: CREATOR_ADDR });
  if (balance < stake * 3n) {
    console.warn(`[market-creator] Insufficient balance for ${candidate.question.slice(0, 40)}`);
    return null;
  }

  try {
    const txHash = await executeContract({
      walletId:             CREATOR_WALLET,
      contractAddress:      CONTRACT_ADDRESS,
      abiFunctionSignature: SIG_CREATE_CLAIM,
      abiParameters: toCircleAbiParameters([
        candidate.question,
        candidate.creatorPosition,
        candidate.counterPosition,
        candidate.resolutionUrl,
        deadline,
        stake,
        candidate.category,
        BigInt(0),                   // parentId
        candidate.marketType,
        "pool",                      // oddsMode
        BigInt(0),                   // challengerPayoutBps
        "",                          // handicapLine
        candidate.settlementRule,
        BigInt(100),                 // maxChallengers
        false,                       // isPrivate
        "",                          // inviteKey
      ]),
      amount: stake.toString(),
      refId:  `mc-${Date.now()}`,
    });
    return txHash;
  } catch (err) {
    console.error(`[market-creator] Failed to create claim:`, err);
    return null;
  }
}

// ── Main run ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const balance = await publicClient.getBalance({ address: CREATOR_ADDR });

  console.log(`\n[market-creator] ── Run at ${new Date().toISOString()}`);
  console.log(`[market-creator] Creator : ${CREATOR_ADDR}`);
  console.log(`[market-creator] Balance : ${microToUsdc(balance).toFixed(4)} USDC`);

  // Fetch source data in parallel
  console.log("[market-creator] Fetching market data...");
  const [crypto, sports, weather] = await Promise.all([
    fetchCryptoEvents(),
    fetchSportsEvents(),
    fetchWeatherEvents(),
  ]);

  console.log("[market-creator] Drafting claim candidates with Claude...");
  const candidates = await draftClaimCandidates({ crypto, sports, weather });

  if (candidates.length === 0) {
    console.log("[market-creator] No high-quality candidates this run.");
    return;
  }

  console.log(`[market-creator] ${candidates.length} candidates (score ≥ ${MIN_QUALITY_SCORE}):`);
  candidates.forEach((c, i) => {
    console.log(`  ${i + 1}. [${c.qualityScore}] ${c.question.slice(0, 70)}...`);
  });

  let created = 0;
  for (const candidate of candidates.slice(0, MAX_CLAIMS_PER_RUN)) {
    console.log(`\n[market-creator] Creating: "${candidate.question.slice(0, 60)}..."`);
    const txHash = await createClaim(candidate);
    if (txHash) {
      console.log(`[market-creator] ✓ Created — ${getExplorerTxUrl(txHash)}`);
      created++;
    }
    // Brief pause between claims to avoid nonce issues
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n[market-creator] Created ${created}/${candidates.length} markets this run.`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const balance = await publicClient.getBalance({ address: CREATOR_ADDR });

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Market Creator Agent (Circle W3S signer)");
  console.log(`  Creator    : ${CREATOR_ADDR}`);
  console.log(`  Wallet ID  : ${CREATOR_WALLET}`);
  console.log(`  Balance    : ${microToUsdc(balance).toFixed(4)} USDC`);
  console.log(`  Network    : Arc Testnet (${arcTestnet.id})`);
  console.log(`  Stake/mkt  : ${CREATOR_STAKE_USDC} USDC`);
  console.log(`  Max/run    : ${MAX_CLAIMS_PER_RUN} claims`);
  console.log(`  Interval   : every ${RUN_INTERVAL_HOURS}h`);
  console.log("═══════════════════════════════════════════════\n");

  await run();
  setInterval(run, RUN_INTERVAL_HOURS * 3600 * 1000);
}

main().catch((err) => {
  console.error("[market-creator] Fatal:", err);
  process.exit(1);
});
