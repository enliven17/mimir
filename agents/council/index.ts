/**
 * Mimir Council Worker
 *
 * Boots a single Node process that runs 10 AI personas as autonomous
 * economic actors on every deployed chain. Every cycle:
 *
 *   1. Reads claimCount + each open/active claim from the contract.
 *   2. Builds a per-cycle evidence cache so 10 personas share 1 HTTP
 *      fetch per resolution URL.
 *   3. For each (claim, persona) pair, runs the decision pipeline:
 *        - Specialists skip out-of-category claims (no LLM call)
 *        - Rule-based personas evaluate from pool state (no LLM call)
 *        - LLM personas call Gemini with a persona-specific prompt prefix
 *   4. Submits challengeClaim through the persona's W3S wallet when the
 *      decision says stake.
 *
 * Rate-limit strategy:
 *   - Personas are processed sequentially within a cycle (not in parallel).
 *   - Gemini free tier = 15 req/min. With 10 LLM personas across ~60s of
 *     work per cycle, we stay comfortably under.
 *   - Rule-based + category-filtered personas don't consume LLM budget.
 *
 * Multichain: the cycle runs once per enabled chain. A persona acts on a chain
 * only when it has a W3S wallet there (CIRCLE_COUNCIL_<SLUG>_WALLET_ID on Arc,
 * + _BASE / _ARBITRUM elsewhere); COUNCIL_MAX_CLAIMS applies per chain, so
 * every network gets council attention each cycle. One chain's RPC failing
 * skips that chain for the cycle, never the others.
 *
 * Run: npm run council  (or via "npm run workers" alongside oracle + market-creator)
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET,
 *      CIRCLE_COUNCIL_<SLUG>_WALLET_ID[_BASE|_ARBITRUM] + _ADDRESS per persona,
 *      NEXT_PUBLIC_*CONTRACT_ADDRESS,
 *      GEMINI_API_KEY (preferred) OR ANTHROPIC_API_KEY
 *      COUNCIL_PERSONAS_ACTIVE (optional CSV of slugs, e.g.
 *        "optimist,pessimist,statistician,whale_watcher,doomer" — restricts
 *        active personas to this subset, cuts LLM load proportionally).
 */

// Worker-scoped Gemini key. Falls back to the shared GEMINI_API_KEY when
// COUNCIL_GEMINI_API_KEY is not set. See agents/oracle/index.ts for the
// rationale: each worker gets its own 20 RPM free-tier bucket.
applyWorkerGeminiKey("COUNCIL_GEMINI_API_KEY");

import { requireEnv, requireAnyLLMKey, applyWorkerGeminiKey } from "../../lib/agent-bootstrap";
import { createChainPublicClient, getContractAddress } from "../../lib/arc";
import { enabledChainKeys, getChain, type ChainKey } from "../../lib/chains";
import { walletIdEnvFor } from "../../lib/w3s-escrow";
import { MIMIR_ABI, STATE } from "../../lib/mimir-abi";
import { fetchDecodedClaim } from "../../lib/claim-codec";
import { activeLLMProvider, activeLLMModel, activeLLMKeyFingerprint } from "../../lib/llm";
import {
  COUNCIL_PERSONAS,
  personaAddressEnv,
  type PersonaSpec,
} from "./personas";
import { peerReasoningKey, runPersonaForClaim } from "./shared/persona-runner";
import { buyPeerReasoning } from "./shared/peer-reasoning";
import { personaAddressOf, personaWalletIdOn } from "./shared/wallets";
import { chainTag, stakeBalanceUsdc } from "../shared/chains";
import { atomicToUsdc } from "../../lib/x402";
import type {
  ClaimOnChain,
  PersonaRunnerContext,
  EvidenceCacheEntry,
} from "./shared/types";
import { reportingPoll } from "../../lib/ops/heartbeat";

const POLL_INTERVAL_MS = Number(process.env.COUNCIL_POLL_INTERVAL_MS ?? 180_000);
/**
 * Per-cycle work cap to stay under Gemini free-tier rate limits.
 * Claims are sorted by deadline-proximity so the council focuses on
 * the markets closest to settling.
 */
const MAX_CLAIMS_PER_CYCLE = Number(process.env.COUNCIL_MAX_CLAIMS ?? 1);
const DECISION_DELAY_MS    = Number(process.env.COUNCIL_DECISION_DELAY_MS ?? 30000);
const PEER_READS_ENABLED   = process.env.COUNCIL_PEER_READS === "1";
const PEER_READS_BASE_URL  = process.env.MIMIR_BASE_URL ?? "http://localhost:3000";
const PEER_READS_PER_PERSONA = Number(process.env.COUNCIL_PEER_READS_PER_PERSONA ?? 2);
const PEER_READ_DELAY_MS   = Number(process.env.COUNCIL_PEER_READ_DELAY_MS ?? 15000);
const PEER_READ_CAP_USDC   = Number(process.env.COUNCIL_PEER_READ_CAP_USDC ?? "0.003");

// ── Env guard ─────────────────────────────────────────────────────────────────
requireEnv(["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"]);
requireAnyLLMKey();

// Optional CSV allowlist of persona slugs to keep active. When set, personas
// not in the list are skipped even if their wallets exist — used to scale LLM
// load down without re-provisioning wallets.
const PERSONA_ALLOWLIST = (() => {
  const raw = process.env.COUNCIL_PERSONAS_ACTIVE?.trim();
  if (!raw) return null;
  const slugs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return slugs.length > 0 ? new Set(slugs) : null;
})();

// Optional single-track mode. Twenty personas on one cycle is a lot of LLM
// calls; running one jury at a time keeps the rate limit reachable without
// giving up the other track's wallets.
const TRACK_FILTER = (() => {
  const raw = process.env.COUNCIL_TRACK?.trim().toLowerCase();
  return raw === "classic" || raw === "philosopher" ? raw : null;
})();

const ENABLED_CHAINS = enabledChainKeys();

// Skip personas missing wallet env (e.g. before scripts/create-wallets has run
// for that persona). Warn once at startup, not every cycle.
const ACTIVE_PERSONAS = COUNCIL_PERSONAS.filter((p) => {
  if (PERSONA_ALLOWLIST && !PERSONA_ALLOWLIST.has(p.slug)) {
    return false;
  }
  if (TRACK_FILTER && (p.track ?? "classic") !== TRACK_FILTER) {
    return false;
  }
  const ok =
    !!personaAddressOf(p) && ENABLED_CHAINS.some((c) => !!personaWalletIdOn(p, c));
  if (!ok) {
    console.warn(
      `[council] ${p.emoji} ${p.displayName} is missing wallet env vars — skipping. ` +
      `Run "npm run council:create-wallets" to provision.`,
    );
  }
  return ok;
});

/**
 * Personas able to stake on each chain. A persona without a wallet on a chain
 * sits that chain out; one warning per chain lists them all.
 */
function personasOn(chain: ChainKey): PersonaSpec[] {
  const ready = ACTIVE_PERSONAS.filter((p) => !!personaWalletIdOn(p, chain));
  const missing = ACTIVE_PERSONAS.filter((p) => !personaWalletIdOn(p, chain));
  if (missing.length > 0) {
    console.warn(
      `${chainTag("council", chain)} ${missing.length} persona(s) have no W3S wallet on ${getChain(chain).name} ` +
      `(${walletIdEnvFor("CIRCLE_COUNCIL_<SLUG>_WALLET_ID", chain)}) — they sit this chain out: ` +
      missing.map((p) => p.slug).join(", "),
    );
  }
  return ready;
}

const PERSONAS_BY_CHAIN = new Map<ChainKey, PersonaSpec[]>(
  ENABLED_CHAINS.map((chain) => [chain, personasOn(chain)]),
);
const COUNCIL_CHAINS = ENABLED_CHAINS.filter((c) => (PERSONAS_BY_CHAIN.get(c) ?? []).length > 0);

if (ACTIVE_PERSONAS.length === 0 || COUNCIL_CHAINS.length === 0) {
  console.error("[council] No personas have wallets configured on any enabled chain. Exiting.");
  process.exit(1);
}

// ── Fetch claim ───────────────────────────────────────────────────────────────
async function fetchClaim(chain: ChainKey, claimId: number): Promise<ClaimOnChain | null> {
  try {
    const decoded = await fetchDecodedClaim(createChainPublicClient(chain), getContractAddress(chain), claimId);
    if (!decoded) return null;
    return {
      id:                   decoded.id,
      chain,
      creator:              decoded.creator,
      question:             decoded.question,
      creatorPosition:      decoded.creatorPosition,
      counterPosition:      decoded.counterPosition,
      resolutionUrl:        decoded.resolutionUrl,
      creatorStake:         decoded.creatorStake,
      totalChallengerStake: decoded.totalChallengerStake,
      deadline:             decoded.deadline,
      state:                decoded.state,
      category:             decoded.category,
      challengerCount:      decoded.challengerCount,
      marketType:           decoded.marketType,
      settlementRule:       decoded.settlementRule,
      maxChallengers:       decoded.maxChallengers,
      isPrivate:            decoded.isPrivate,
    };
  } catch {
    return null;
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
/** Joinable claims on one chain, closest deadline first. Throws on RPC failure. */
async function joinableClaims(chain: ChainKey, now: bigint): Promise<ClaimOnChain[]> {
  const total = await createChainPublicClient(chain).readContract({
    address: getContractAddress(chain), abi: MIMIR_ABI, functionName: "claimCount",
  }) as bigint;
  console.log(`${chainTag("council", chain)} ${total} claims, ${(PERSONAS_BY_CHAIN.get(chain) ?? []).length} personas`);

  const claims: ClaimOnChain[] = [];
  for (let id = 1; id <= Number(total); id++) {
    const claim = await fetchClaim(chain, id);
    if (!claim) continue;
    const joinable =
      (claim.state === STATE.OPEN || claim.state === STATE.ACTIVE) &&
      claim.deadline > now;
    if (joinable) claims.push(claim);
  }
  // Focus on claims closest to settling — they're the most interesting for
  // the council to weigh in on and keeps LLM-call volume bounded.
  return claims.sort((a, b) => Number(a.deadline - b.deadline));
}

/** Buys peer reads for one (persona, claim) pair and stores them in `peerReasoning`. */
async function buyPeerReadsFor(
  chain: ChainKey,
  persona: PersonaSpec,
  personas: PersonaSpec[],
  claim: ClaimOnChain,
  peerReasoning: Map<string, string[]>,
): Promise<void> {
  const reads = await buyPeerReasoning({
    buyer: persona,
    activePersonas: personas,
    chain,
    claimId: claim.id,
    baseUrl: PEER_READS_BASE_URL,
    readsPerPersona: PEER_READS_PER_PERSONA,
    capUsdc: PEER_READ_CAP_USDC,
    delayMs: PEER_READ_DELAY_MS,
  });
  if (reads.length === 0) return;
  peerReasoning.set(
    peerReasoningKey(chain, claim.id, persona.slug),
    reads.map((read) => `${read.sellerName}: ${read.reasoning}`),
  );
  const paidUsdc = reads.reduce(
    (sum, read) => sum + atomicToUsdc(read.pricePaidAtomic ?? "0"),
    0,
  );
  console.log(
    `[council:${persona.slug}][${chain}] bought ${reads.length} peer read(s) for claim #${claim.id} ` +
    `(${paidUsdc.toFixed(6)} USDC)`,
  );
}

/** One chain's cycle. Returns the number of stakes submitted. */
async function pollChain(chain: ChainKey, now: bigint): Promise<number> {
  const tag = chainTag("council", chain);
  const personas = PERSONAS_BY_CHAIN.get(chain) ?? [];
  const allClaims = await joinableClaims(chain, now);
  if (allClaims.length === 0) {
    console.log(`${tag} No joinable claims this round.`);
    return 0;
  }

  const claims = allClaims.slice(0, MAX_CLAIMS_PER_CYCLE);
  if (claims.length < allClaims.length) {
    console.log(
      `${tag} Evaluating ${claims.length} of ${allClaims.length} joinable claims this cycle (deadline-prioritized).`,
    );
  }

  // Shared per-cycle evidence cache — one HTTP fetch per claim no matter
  // how many personas need it.
  const peerReasoning = new Map<string, string[]>();
  const ctx: PersonaRunnerContext = {
    chain,
    publicClient: createChainPublicClient(chain),
    contractAddress: getContractAddress(chain),
    evidenceCache: new Map<string, EvidenceCacheEntry>(),
    peerReasoning,
  };

  let stakes = 0;
  for (const persona of personas) {
    for (const claim of claims) {
      try {
        if (PEER_READS_ENABLED && PEER_READS_PER_PERSONA > 0) {
          await buyPeerReadsFor(chain, persona, personas, claim, peerReasoning);
        }
        const receipt = await runPersonaForClaim(persona, claim, ctx);
        if (receipt) stakes += 1;
      } catch (err) {
        console.error(
          `[council:${persona.slug}][${chain}] error on claim #${claim.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
      if (DECISION_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, DECISION_DELAY_MS));
      }
    }
  }
  return stakes;
}

async function poll(): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  console.log(
    `\n[council] ── Poll at ${new Date().toISOString()} ── chains: ${COUNCIL_CHAINS.join(", ")}, ${ACTIVE_PERSONAS.length} personas`,
  );

  let stakesThisCycle = 0;
  for (const chain of COUNCIL_CHAINS) {
    try {
      stakesThisCycle += await pollChain(chain, now);
    } catch (err) {
      console.warn(
        `${chainTag("council", chain)} Cycle failed, skipping this chain:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    stakesThisCycle > 0
      ? `[council] Cycle complete — ${stakesThisCycle} new stakes submitted.`
      : "[council] Cycle complete — no new stakes.",
  );
}

// ── Entry ─────────────────────────────────────────────────────────────────────
async function logPersonaBalances(): Promise<void> {
  for (const p of ACTIVE_PERSONAS) {
    const addr = process.env[personaAddressEnv(p)] as `0x${string}`;
    const perChain = await Promise.all(
      COUNCIL_CHAINS.filter((c) => !!personaWalletIdOn(p, c)).map(async (c) => {
        const usdc = await stakeBalanceUsdc(c, addr).catch(() => null);
        return `${c}=${usdc === null ? "?" : usdc.toFixed(2)}`;
      }),
    );
    console.log(
      `  ${p.emoji} ${p.displayName.padEnd(22)} ${addr.slice(0, 6)}…${addr.slice(-4)} · USDC ${perChain.join(" ")}`,
    );
  }
}

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Council — 10 AI personas as economic actors");
  for (const c of COUNCIL_CHAINS) {
    console.log(`  ${getChain(c).shortName.padEnd(15)}: ${getContractAddress(c)} (${getChain(c).chain.id}) · ${(PERSONAS_BY_CHAIN.get(c) ?? []).length} personas`);
  }
  console.log(`  LLM            : ${activeLLMProvider()} / ${activeLLMModel()} · key=${activeLLMKeyFingerprint()}`);
  console.log(`  Active personas: ${ACTIVE_PERSONAS.length} / ${COUNCIL_PERSONAS.length}`);
  console.log(`  Max claims/cycle: ${MAX_CLAIMS_PER_CYCLE} per chain`);
  console.log(`  Decision gap   : ${DECISION_DELAY_MS / 1000}s`);
  console.log(`  Peer reads     : ${PEER_READS_ENABLED ? `${PEER_READS_PER_PERSONA}/persona via ${PEER_READS_BASE_URL}` : "off"}`);
  console.log(`  Peer read gap  : ${PEER_READ_DELAY_MS / 1000}s`);
  console.log(`  Poll every     : ${POLL_INTERVAL_MS / 1000}s`);
  console.log("───────────────────────────────────────────────");
  await logPersonaBalances();
  console.log("═══════════════════════════════════════════════\n");

  const safePoll = reportingPoll("council", POLL_INTERVAL_MS, poll);

  await safePoll();
  setInterval(safePoll, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[council] fatal:", err);
  process.exit(1);
});
