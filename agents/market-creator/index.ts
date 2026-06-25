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
 *      MAX_ACTIVE_CLAIMS=30      (skip run if joinable on-chain claims >= this)
 *      RUN_INTERVAL_HOURS=6      (hours between runs, default 6h)
 */

// Worker-scoped Gemini key. Falls back to the shared GEMINI_API_KEY when
// CREATOR_GEMINI_API_KEY is not set. See agents/oracle/index.ts for the
// rationale.
{
  const k = process.env.CREATOR_GEMINI_API_KEY?.trim();
  if (k) process.env.GEMINI_API_KEY = k;
}

import { formatEther } from "viem";
import { callLLM, activeLLMProvider, activeLLMModel, activeLLMKeyFingerprint } from "../../lib/llm";
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
import { MIMIR_ABI, STATE } from "../../lib/mimir-abi";

// ── Config ────────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS    = getContractAddress();
const CREATOR_STAKE_USDC  = Number(process.env.CREATOR_STAKE_USDC ?? "2");
const MAX_CLAIMS_PER_RUN  = Number(process.env.MAX_CLAIMS_PER_RUN ?? "5");
const MAX_ACTIVE_CLAIMS   = Number(process.env.MAX_ACTIVE_CLAIMS ?? "30");
const RUN_INTERVAL_HOURS  = Number(process.env.RUN_INTERVAL_HOURS ?? "6");
const MIN_QUALITY_SCORE   = 70; // 0-100
const CRYPTO_MIN_THRESHOLD_RATIO = Number(process.env.CRYPTO_MIN_THRESHOLD_RATIO ?? "0.65");
const CRYPTO_MAX_THRESHOLD_RATIO = Number(process.env.CRYPTO_MAX_THRESHOLD_RATIO ?? "1.35");

for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_CREATOR_WALLET_ID", "CIRCLE_CREATOR_ADDRESS"]) {
  if (!process.env[v]) {
    console.error(`${v} env var is required`);
    process.exit(1);
  }
}
if (
  !process.env.GEMINI_API_KEY?.trim() &&
  !process.env.ANTHROPIC_API_KEY?.trim() &&
  !process.env.GROQ_API_KEY?.trim() &&
  !process.env.GROQ_API_KEYS?.trim() &&
  !process.env.OPENROUTER_API_KEY?.trim()
) {
  console.error("Set at least one LLM key: GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY/GROQ_API_KEYS, or OPENROUTER_API_KEY");
  process.exit(1);
}

const SIG_CREATE_CLAIM = buildAbiFunctionSignature("createClaim", MIMIR_ABI);
const SIG_CANCEL_CLAIM = buildAbiFunctionSignature("cancelClaim", MIMIR_ABI);

// ── Clients ───────────────────────────────────────────────────────────────────
const publicClient   = createArcPublicClient();
const CREATOR_WALLET = getMarketCreatorWalletId();
const CREATOR_ADDR   = getMarketCreatorAddress();

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

interface ExistingClaimSignature {
  id:               number;
  category:         string;
  questionKey:      string;
  resolutionUrlKey: string;
}

interface SportEvent {
  id:            string;
  name:          string;
  startDate:     string;  // ISO 8601
  startMs:       number;  // epoch ms (NaN if unparseable)
  resolutionUrl: string;
  status:        string;
}

interface CryptoEvent {
  id:            string;  // coingecko slug (e.g. "bitcoin")
  name:          string;
  symbol:        string;
  resolutionUrl: string;
  priceUsd:      number;
}

interface StockEvent {
  symbol:        string;  // ticker (e.g. "AAPL")
  name:          string;
  resolutionUrl: string;  // stockanalysis.com page (oracle scrapes price/day change)
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function extractUsdThresholds(text: string): number[] {
  const thresholds: number[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([kKmMbBtT]))?/g,
    /\b([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:USD|US dollars?|dollars?)\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1]?.replace(/,/g, "");
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      const suffix = match[2]?.toLowerCase();
      const multiplier = suffix === "k" ? 1_000
        : suffix === "m" ? 1_000_000
        : suffix === "b" ? 1_000_000_000
        : suffix === "t" ? 1_000_000_000_000
        : 1;
      const value = parsed * multiplier;
      const key = value.toString();
      if (!seen.has(key)) {
        seen.add(key);
        thresholds.push(value);
      }
    }
  }

  return thresholds;
}

function cryptoThresholdReason(candidate: ClaimCandidate, event: CryptoEvent): string | null {
  if (!Number.isFinite(event.priceUsd) || event.priceUsd <= 0) {
    return `missing live CoinGecko price for ${event.symbol}`;
  }

  const text = [
    candidate.question,
    candidate.settlementRule,
  ].join("\n");
  const thresholds = extractUsdThresholds(text);
  if (thresholds.length === 0) return "no explicit USD price threshold found";

  const low = event.priceUsd * CRYPTO_MIN_THRESHOLD_RATIO;
  const high = event.priceUsd * CRYPTO_MAX_THRESHOLD_RATIO;
  const realistic = thresholds.some((threshold) => threshold >= low && threshold <= high);
  if (!realistic) {
    const rendered = thresholds.map((threshold) => `$${formatUsd(threshold)}`).join(", ");
    return `${rendered} outside live ${event.symbol} guard ($${formatUsd(low)}-$${formatUsd(high)}, current=$${formatUsd(event.priceUsd)})`;
  }

  return null;
}

// ── Source fetchers ───────────────────────────────────────────────────────────

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(will|does|do|did|the|their|a|an|in|on|at|by|before|after|during)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeResolutionUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
}

function buildCandidateSignature(candidate: ClaimCandidate): ExistingClaimSignature {
  return {
    id:               0,
    category:         String(candidate.category ?? "").toLowerCase().trim(),
    questionKey:      normalizeComparableText(String(candidate.question ?? "")),
    resolutionUrlKey: normalizeResolutionUrl(String(candidate.resolutionUrl ?? "")),
  };
}

function filterDuplicateCandidates(
  candidates: ClaimCandidate[],
  existingClaims: ExistingClaimSignature[],
): ClaimCandidate[] {
  const existingQuestionKeys = new Map<string, number>();
  const existingSourceKeys = new Map<string, number>();

  for (const claim of existingClaims) {
    if (claim.questionKey) existingQuestionKeys.set(`${claim.category}:${claim.questionKey}`, claim.id);
    if (claim.resolutionUrlKey) existingSourceKeys.set(`${claim.category}:${claim.resolutionUrlKey}`, claim.id);
  }

  const seenQuestionKeys = new Set<string>();
  const seenSourceKeys = new Set<string>();

  return candidates.filter((candidate) => {
    const sig = buildCandidateSignature(candidate);
    const questionKey = `${sig.category}:${sig.questionKey}`;
    const sourceKey = `${sig.category}:${sig.resolutionUrlKey}`;

    const existingSourceId = sig.resolutionUrlKey ? existingSourceKeys.get(sourceKey) : undefined;
    if (existingSourceId !== undefined) {
      console.warn(`[market-creator] Drop duplicate candidate - same source as active claim #${existingSourceId}: ${candidate.question.slice(0, 90)}`);
      return false;
    }

    const existingQuestionId = sig.questionKey ? existingQuestionKeys.get(questionKey) : undefined;
    if (existingQuestionId !== undefined) {
      console.warn(`[market-creator] Drop duplicate candidate - same question as active claim #${existingQuestionId}: ${candidate.question.slice(0, 90)}`);
      return false;
    }

    if ((sig.resolutionUrlKey && seenSourceKeys.has(sourceKey)) || (sig.questionKey && seenQuestionKeys.has(questionKey))) {
      console.warn(`[market-creator] Drop duplicate candidate within run: ${candidate.question.slice(0, 90)}`);
      return false;
    }

    if (sig.resolutionUrlKey) seenSourceKeys.add(sourceKey);
    if (sig.questionKey) seenQuestionKeys.add(questionKey);
    return true;
  });
}

async function fetchCryptoEvents(): Promise<{ text: string; events: CryptoEvent[] }> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&sparkline=false",
      { headers: { "User-Agent": "Mimir-MarketCreator/1.0" } }
    );
    const coins = await res.json() as any[];
    const events: CryptoEvent[] = (Array.isArray(coins) ? coins : []).map((c: any) => ({
      id:            String(c.id ?? ""),
      name:          String(c.name ?? ""),
      symbol:        String(c.symbol ?? "").toUpperCase(),
      // CoinGecko URLs with /coins/<slug> hit the deterministic API path in
      // lib/server/evidence-fetcher.ts. Always use the slug, never the symbol.
      resolutionUrl: c.id ? `https://www.coingecko.com/en/coins/${c.id}` : "",
      priceUsd:      Number(c.current_price ?? 0),
    })).filter((e) => e.id && e.resolutionUrl);

    const text = events.map((c) =>
      `${c.name} (${c.symbol}, slug=${c.id}): $${c.priceUsd.toFixed(2)}`
    ).join("\n");
    return { text: text || "Crypto data unavailable", events };
  } catch {
    return {
      text: "BTC: ~$95,000, ETH: ~$3,500, SOL: ~$180 (live data unavailable)",
      events: [],
    };
  }
}

// Generic ESPN scoreboard reader. Pulls scheduled (not-started) games for any
// sport/league. Live games make deadline math uncertain and finished games
// resolve immediately — both are dead inventory, so we keep only `pre` state.
async function fetchEspnScoreboard(
  url: string,
  fallbackName: string,
  matchPath: string,
): Promise<SportEvent[]> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mimir-MarketCreator/1.0" } });
    const data = (await res.json()) as any;
    const all = (data.events ?? []) as any[];
    const scheduled = all
      .filter((e: any) => e.status?.type?.state === "pre" && !e.status?.type?.completed)
      .slice(0, 6);

    return scheduled
      .map((e: any) => {
        const links = Array.isArray(e.links) ? e.links : [];
        // Prefer a post-game page (summary/boxscore/recap) — it carries the
        // final result the oracle reads. Fall back to a constructed match URL.
        const post = links.find(
          (l: any) =>
            Array.isArray(l.rel) &&
            (l.rel.includes("summary") || l.rel.includes("boxscore") || l.rel.includes("recap")),
        )?.href;
        const resolutionUrl = post || `https://www.espn.com/${matchPath}/_/gameId/${e.id}`;
        return {
          id:            String(e.id ?? ""),
          name:          String(e.name ?? fallbackName),
          startDate:     String(e.date ?? ""),
          startMs:       Date.parse(String(e.date ?? "")),
          resolutionUrl,
          status:        String(e.status?.type?.detail ?? "scheduled"),
        };
      })
      .filter((ev) => ev.id && ev.resolutionUrl);
  } catch (err) {
    console.warn(`[market-creator] ESPN fetch failed (${url}):`, err);
    return [];
  }
}

async function fetchSportsEvents(): Promise<{ text: string; events: SportEvent[] }> {
  // World Cup first (timely + high interest), then NBA. The off-season sport
  // simply returns nothing and drops out.
  const [worldCup, nba] = await Promise.all([
    fetchEspnScoreboard(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
      "World Cup match",
      "soccer/match",
    ),
    fetchEspnScoreboard(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      "NBA game",
      "nba/boxscore",
    ),
  ]);

  const events = [...worldCup, ...nba].slice(0, 8);
  if (events.length === 0) return { text: "No upcoming games found", events: [] };

  const text = events.map((ev) => `${ev.name} — starts ${ev.startDate} — ${ev.status}`).join("\n");
  return { text, events };
}

// A fixed roster of liquid large-caps. No live price feed is needed: claims are
// framed as intraday direction ("up on the day at the deadline?"), which the
// oracle reads off the stockanalysis.com page's day-change. Markets closed →
// the LLM still drafts forward-looking ones; low-confidence ones refund.
const STOCK_TICKERS: Array<{ symbol: string; name: string }> = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
];

function fetchStockEvents(): { text: string; events: StockEvent[] } {
  const events: StockEvent[] = STOCK_TICKERS.map((s) => ({
    symbol:        s.symbol,
    name:          s.name,
    resolutionUrl: `https://stockanalysis.com/stocks/${s.symbol.toLowerCase()}/`,
  }));
  const text = events.map((e) => `${e.name} (${e.symbol}) → ${e.resolutionUrl}`).join("\n");
  return { text, events };
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

// Sports games need their result + ESPN boxscore page settled before the
// oracle can read a final score. Two-hour NBA game + ~2h boxscore lag buffer.
const SPORTS_POST_GAME_BUFFER_MS = 4 * 3600 * 1000;

async function draftClaimCandidates(sourceData: {
  cryptoText:   string;
  cryptoEvents: CryptoEvent[];
  sportsText:   string;
  sportsEvents: SportEvent[];
  stocksText:   string;
  stocksEvents: StockEvent[];
  weather:      string;
}): Promise<ClaimCandidate[]> {
  const now = new Date();

  const allowedUrlsList = [
    ...sourceData.sportsEvents.map((e) =>
      `- [sports] "${e.name}" (gameId=${e.id}, starts=${e.startDate}) → ${e.resolutionUrl}`
    ),
    ...sourceData.cryptoEvents.map((c) =>
      `- [crypto] "${c.name}" (${c.symbol}, current=$${formatUsd(c.priceUsd)}) -> ${c.resolutionUrl}`
    ),
    ...sourceData.stocksEvents.map((s) =>
      `- [stocks] "${s.name}" (${s.symbol}) → ${s.resolutionUrl}`
    ),
  ].join("\n");

  const prompt = `You are Mimir, an AI that creates high-quality prediction market claims for a USDC market on Arc blockchain.

## Current Data Sources

### Crypto Markets (from CoinGecko)
${sourceData.cryptoText}

### Upcoming Matches (from ESPN — World Cup soccer + NBA, scheduled, not yet started)
${sourceData.sportsText}

### Stocks (large-caps — resolve intraday direction from the page)
${sourceData.stocksText}

### Weather Opportunity
${sourceData.weather}

## ALLOWED RESOLUTION URLs (CRITICAL — read carefully)
For sports and crypto candidates you MUST copy one of the URLs below verbatim into
"resolutionUrl". Do NOT invent, modify, shorten, or guess URLs — if no URL matches
the topic you want, skip that topic. URLs not on this list will be rejected and
the candidate will be dropped before it reaches the chain.

${allowedUrlsList || "(no allowed URLs available this run — skip sports/crypto candidates)"}

## Task
Create ${MAX_CLAIMS_PER_RUN} prediction market claim candidates. Each must be:
- **Verifiable**: resolvable from one of the URLs listed above
- **Binary or near-binary**: clear winner/loser outcome
- **Time-bounded**: deadline between 2-72 hours from now (${now.toISOString()})
- **For sports (World Cup / NBA)**: deadlineHours MUST place the deadline AT LEAST 4 hours AFTER the listed start time. Never create a market on a game that has already started or finished. Frame as match outcome (e.g. "Will Brazil beat Scotland?").
- **For crypto**: use the live CoinGecko price shown above. Create only single-asset USD price threshold markets for the listed coin URL. The threshold MUST be realistic for a 2-72 hour deadline: between ${Math.round(CRYPTO_MIN_THRESHOLD_RATIO * 100)}% and ${Math.round(CRYPTO_MAX_THRESHOLD_RATIO * 100)}% of the current price. Do NOT create stale moonshot targets, total-market-cap claims, or thresholds copied from old examples.
- **For stocks**: frame as intraday direction resolvable from the page (e.g. "Will AAPL close up on the day?") — do NOT invent a specific price target you can't verify.
- **Specific**: no vague language like "probably" or "might"

For each candidate, provide:
{
  "question": "Will [specific thing] happen by [specific date/time]?",
  "creatorPosition": "Yes — [brief reason]",
  "counterPosition": "No — [brief reason]",
  "resolutionUrl": "<one of the URLs listed above, EXACTLY>",
  "category": "crypto" | "sports" | "stocks" | "weather" | "culture",
  "marketType": "binary",
  "settlementRule": "Resolve YES if [exact condition] at the resolution URL at deadline.",
  "deadlineHours": <2-72>,
  "qualityScore": <0-100>,  // your confidence this claim is clear and verifiable
  "sourceType": "coingecko" | "espn" | "stockanalysis" | "weather" | "custom"
}

Return a JSON array of ${MAX_CLAIMS_PER_RUN} candidates. Output JSON only.`;

  const text = await callLLM(prompt, { maxTokens: 2000, jsonOnly: true });
  let candidates: ClaimCandidate[];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array in response");
    candidates = JSON.parse(jsonMatch[0]) as ClaimCandidate[];
  } catch (err) {
    console.warn("[market-creator] Failed to parse candidates:", err);
    return [];
  }

  // Allowlist enforcement — the LLM still hallucinates URLs sometimes even
  // with a strict prompt. Drop the candidate here rather than letting the
  // oracle waste an LLM call on an unresolvable claim. Sports gets an extra
  // deadline-vs-tipoff guard so we don't create markets whose deadline falls
  // before the game ends.
  const sportsUrls = new Map(sourceData.sportsEvents.map((e) => [e.resolutionUrl, e]));
  const cryptoUrls = new Map(sourceData.cryptoEvents.map((c) => [c.resolutionUrl, c]));
  const stocksUrls = new Set(sourceData.stocksEvents.map((s) => s.resolutionUrl));
  const nowMs      = Date.now();

  return candidates.filter((c) => {
    if (typeof c?.qualityScore !== "number" || c.qualityScore < MIN_QUALITY_SCORE) {
      return false;
    }
    const cat = String(c.category ?? "").toLowerCase();
    const url = String(c.resolutionUrl ?? "");

    if (cat === "sports") {
      const game = sportsUrls.get(url);
      if (!game) {
        console.warn(`[market-creator] Drop sports candidate — URL not in allowlist: ${url}`);
        return false;
      }
      const deadlineMs = nowMs + Number(c.deadlineHours ?? 0) * 3600 * 1000;
      const minDeadline = Number.isFinite(game.startMs)
        ? game.startMs + SPORTS_POST_GAME_BUFFER_MS
        : nowMs;
      if (deadlineMs < minDeadline) {
        console.warn(
          `[market-creator] Drop sports candidate — deadline ${new Date(deadlineMs).toISOString()} ` +
          `is before tipoff+4h (${new Date(minDeadline).toISOString()})`
        );
        return false;
      }
      return true;
    }

    if (cat === "crypto") {
      const event = cryptoUrls.get(url);
      if (!event) {
        console.warn(`[market-creator] Drop crypto candidate — URL not in allowlist: ${url}`);
        return false;
      }
      const reason = cryptoThresholdReason(c, event);
      if (reason) {
        console.warn(`[market-creator] Drop crypto candidate - ${reason}: ${c.question.slice(0, 90)}`);
        return false;
      }
      return true;
    }

    if (cat === "stocks") {
      if (!stocksUrls.has(url)) {
        console.warn(`[market-creator] Drop stocks candidate — URL not in allowlist: ${url}`);
        return false;
      }
      return true;
    }

    // weather / culture / other: no allowlist — let it through. The oracle's
    // own evidence fetcher + low-confidence refund path handles these.
    return true;
  });
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
      amount: formatEther(stake), // Circle expects decimal USDC, not wei
      refId:  `mc-${Date.now()}`,
    });
    return txHash;
  } catch (err) {
    console.error(`[market-creator] Failed to create claim:`, err);
    return null;
  }
}

// ── Cancel sweep + joinable count ─────────────────────────────────────────────
// `cancelClaim` is creator-only and only valid while the claim is still OPEN
// (no challengers). It has no deadline guard, so we add one ourselves: only
// cancel claims whose deadline has passed — otherwise we'd kill markets that
// might still get a challenger. Stake is refunded by the contract on cancel.
//
// The same single-pass walk also counts JOINABLE claims (state ∈ {OPEN,ACTIVE}
// && deadline > now). This is the right inventory signal — getPlatformStats
// returns `claimCount - totalResolved`, which lumps CANCELLED and abandoned
// expired-OPEN claims (created by other addresses, no challenger, no
// cancellation rights) into "unresolved" and falsely saturates the cap.

const CREATOR_ADDR_LC = CREATOR_ADDR.toLowerCase();

async function sweepAndCount(): Promise<{ cancelled: number; joinable: number; joinableClaims: ExistingClaimSignature[] }> {
  let total: bigint;
  try {
    total = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: MIMIR_ABI, functionName: "claimCount",
    }) as bigint;
  } catch (err) {
    console.warn("[market-creator] Failed to read claimCount for sweep:", err);
    return { cancelled: 0, joinable: 0, joinableClaims: [] };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  let cancelled = 0;
  let joinable = 0;
  const joinableClaims: ExistingClaimSignature[] = [];

  for (let id = 1; id <= Number(total); id++) {
    let claim: any;
    try {
      claim = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: MIMIR_ABI,
        functionName: "getClaim", args: [BigInt(id)],
      });
    } catch {
      continue;
    }
    if (!claim) continue;
    const creator  = String(claim[0]).toLowerCase();
    const deadline = BigInt(claim[8]);
    const state    = Number(claim[9]);

    if ((state === STATE.OPEN || state === STATE.ACTIVE) && deadline > now) {
      joinable++;
      joinableClaims.push({
        id,
        category:         String(claim[13] ?? "").toLowerCase().trim(),
        questionKey:      normalizeComparableText(String(claim[1] ?? "")),
        resolutionUrlKey: normalizeResolutionUrl(String(claim[4] ?? "")),
      });
    }

    if (creator !== CREATOR_ADDR_LC) continue;
    if (state !== STATE.OPEN) continue;
    if (deadline > now) continue;

    console.log(`[market-creator] Cancelling stale claim #${id} (expired, no challenger)`);
    try {
      const txHash = await executeContract({
        walletId:             CREATOR_WALLET,
        contractAddress:      CONTRACT_ADDRESS,
        abiFunctionSignature: SIG_CANCEL_CLAIM,
        abiParameters:        toCircleAbiParameters([BigInt(id)]),
        refId:                `mc-cancel-${id}`,
      });
      console.log(`[market-creator] ✓ Cancelled #${id} — ${getExplorerTxUrl(txHash)}`);
      cancelled++;
      // brief gap to avoid nonce races
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[market-creator] Failed to cancel #${id}:`, err);
    }
  }
  return { cancelled, joinable, joinableClaims };
}

// ── Main run ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const balance = await publicClient.getBalance({ address: CREATOR_ADDR });

  console.log(`\n[market-creator] ── Run at ${new Date().toISOString()}`);
  console.log(`[market-creator] Creator : ${CREATOR_ADDR}`);
  console.log(`[market-creator] Balance : ${microToUsdc(balance).toFixed(4)} USDC`);

  // Single-pass sweep: cancels creator's stale expired-OPEN claims AND counts
  // joinable inventory (state ∈ {OPEN,ACTIVE} && deadline > now) on the same
  // claim walk. Joinable count drives the cap — getPlatformStats was wrong
  // here because it counted CANCELLED and abandoned expired-OPEN claims as
  // "unresolved" and deadlocked the creator at the cap forever.
  const { cancelled, joinable, joinableClaims } = await sweepAndCount();
  if (cancelled > 0) {
    console.log(`[market-creator] Cancelled ${cancelled} stale claim(s) — stake refunded.`);
  }

  console.log(`[market-creator] Joinable on-chain: ${joinable} (cap: ${MAX_ACTIVE_CLAIMS})`);
  if (joinable >= MAX_ACTIVE_CLAIMS) {
    console.log(`[market-creator] Inventory ≥ cap — skipping this run.`);
    return;
  }
  const headroom = Math.max(0, MAX_ACTIVE_CLAIMS - joinable);
  const toCreate = Math.min(MAX_CLAIMS_PER_RUN, headroom);

  // Fetch source data in parallel
  console.log("[market-creator] Fetching market data...");
  const [crypto, sports, weather] = await Promise.all([
    fetchCryptoEvents(),
    fetchSportsEvents(),
    fetchWeatherEvents(),
  ]);
  const stocks = fetchStockEvents();
  console.log(
    `[market-creator] Sources: crypto=${crypto.events.length} pairs, ` +
    `sports=${sports.events.length} games, stocks=${stocks.events.length} tickers`
  );

  console.log("[market-creator] Drafting claim candidates...");
  const draftedCandidates = await draftClaimCandidates({
    cryptoText:   crypto.text,
    cryptoEvents: crypto.events,
    sportsText:   sports.text,
    sportsEvents: sports.events,
    stocksText:   stocks.text,
    stocksEvents: stocks.events,
    weather,
  });
  const candidates = filterDuplicateCandidates(draftedCandidates, joinableClaims);

  if (candidates.length === 0) {
    console.log("[market-creator] No high-quality candidates this run.");
    return;
  }

  console.log(`[market-creator] ${candidates.length} candidates (score ≥ ${MIN_QUALITY_SCORE}):`);
  candidates.forEach((c, i) => {
    console.log(`  ${i + 1}. [${c.qualityScore}] ${c.question.slice(0, 70)}...`);
  });

  let created = 0;
  for (const candidate of candidates.slice(0, toCreate)) {
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
  console.log(`  LLM        : ${activeLLMProvider()} / ${activeLLMModel()} · key=${activeLLMKeyFingerprint()}`);
  console.log(`  Stake/mkt  : ${CREATOR_STAKE_USDC} USDC`);
  console.log(`  Max/run    : ${MAX_CLAIMS_PER_RUN} claims`);
  console.log(`  Active cap : ${MAX_ACTIVE_CLAIMS} unresolved (skip run above this)`);
  console.log(`  Interval   : every ${RUN_INTERVAL_HOURS}h`);
  console.log("═══════════════════════════════════════════════\n");

  const safeRun = async () => {
    try {
      await run();
    } catch (err) {
      console.error("[market-creator] Run failed, will retry next interval:", err);
    }
  };

  await safeRun();
  setInterval(safeRun, RUN_INTERVAL_HOURS * 3600 * 1000);
}

main().catch((err) => {
  console.error("[market-creator] Fatal:", err);
  process.exit(1);
});
