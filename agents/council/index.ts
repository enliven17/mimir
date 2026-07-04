/**
 * Mimir Council Worker
 *
 * Boots a single Node process that runs 10 AI personas as autonomous
 * economic actors on Arc. Every cycle:
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
 * Run: npm run council  (or via "npm run workers" alongside oracle + market-creator)
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET,
 *      CIRCLE_COUNCIL_<SLUG>_WALLET_ID + _ADDRESS for each persona,
 *      NEXT_PUBLIC_CONTRACT_ADDRESS,
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
import {
  createArcPublicClient,
  arcTestnet,
  getContractAddress,
  weiToUsdc,
} from "../../lib/arc";
import { MIMIR_ABI, STATE } from "../../lib/mimir-abi";
import { fetchDecodedClaim } from "../../lib/claim-codec";
import { activeLLMProvider, activeLLMModel, activeLLMKeyFingerprint } from "../../lib/llm";
import {
  COUNCIL_PERSONAS,
  personaAddressEnv,
  personaWalletIdEnv,
} from "./personas";
import { runPersonaForClaim } from "./shared/persona-runner";
import { buyPeerReasoning } from "./shared/peer-reasoning";
import { atomicToUsdc } from "../../lib/x402";
import type {
  ClaimOnChain,
  PersonaRunnerContext,
  EvidenceCacheEntry,
} from "./shared/types";

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
const CONTRACT_ADDRESS     = getContractAddress();
const publicClient         = createArcPublicClient();

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

// Skip personas missing wallet env (e.g. before scripts/create-wallets has run
// for that persona). Warn once at startup, not every cycle.
const ACTIVE_PERSONAS = COUNCIL_PERSONAS.filter((p) => {
  if (PERSONA_ALLOWLIST && !PERSONA_ALLOWLIST.has(p.slug)) {
    return false;
  }
  const ok =
    !!process.env[personaWalletIdEnv(p)] && !!process.env[personaAddressEnv(p)];
  if (!ok) {
    console.warn(
      `[council] ${p.emoji} ${p.displayName} is missing wallet env vars — skipping. ` +
      `Run "npm run council:create-wallets" to provision.`,
    );
  }
  return ok;
});

if (ACTIVE_PERSONAS.length === 0) {
  console.error("[council] No personas have wallets configured. Exiting.");
  process.exit(1);
}

// ── Fetch claim ───────────────────────────────────────────────────────────────
async function fetchClaim(claimId: number): Promise<ClaimOnChain | null> {
  try {
    const decoded = await fetchDecodedClaim(publicClient, CONTRACT_ADDRESS, claimId);
    if (!decoded) return null;
    return {
      id:                   decoded.id,
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
async function poll(): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));

  let total: bigint;
  try {
    total = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: MIMIR_ABI, functionName: "claimCount",
    }) as bigint;
  } catch (err) {
    console.warn("[council] Failed to read claimCount:", err);
    return;
  }

  console.log(
    `\n[council] ── Poll at ${new Date().toISOString()} ── ${total} claims, ${ACTIVE_PERSONAS.length} personas`,
  );

  // Shared per-cycle evidence cache — one HTTP fetch per claim no matter
  // how many personas need it.
  const evidenceCache = new Map<number, EvidenceCacheEntry>();
  const peerReasoning = new Map<string, string[]>();
  const ctx: PersonaRunnerContext = {
    publicClient,
    contractAddress: CONTRACT_ADDRESS,
    evidenceCache,
    peerReasoning,
  };

  // Pre-load joinable claims so we don't refetch in the inner loop.
  const allClaims: ClaimOnChain[] = [];
  for (let id = 1; id <= Number(total); id++) {
    const claim = await fetchClaim(id);
    if (!claim) continue;
    const joinable =
      (claim.state === STATE.OPEN || claim.state === STATE.ACTIVE) &&
      claim.deadline > now;
    if (joinable) allClaims.push(claim);
  }
  if (allClaims.length === 0) {
    console.log("[council] No joinable claims this round.");
    return;
  }

  // Focus on claims closest to settling — they're the most interesting for
  // the council to weigh in on and keeps LLM-call volume bounded.
  allClaims.sort((a, b) => Number(a.deadline - b.deadline));
  const claims = allClaims.slice(0, MAX_CLAIMS_PER_CYCLE);
  if (claims.length < allClaims.length) {
    console.log(
      `[council] Evaluating ${claims.length} of ${allClaims.length} joinable claims this cycle (deadline-prioritized).`,
    );
  }

  let stakesThisCycle = 0;

  for (const persona of ACTIVE_PERSONAS) {
    for (const claim of claims) {
      try {
        if (PEER_READS_ENABLED && PEER_READS_PER_PERSONA > 0) {
          const reads = await buyPeerReasoning({
            buyer: persona,
            activePersonas: ACTIVE_PERSONAS,
            claimId: claim.id,
            baseUrl: PEER_READS_BASE_URL,
            readsPerPersona: PEER_READS_PER_PERSONA,
            capUsdc: PEER_READ_CAP_USDC,
            delayMs: PEER_READ_DELAY_MS,
          });
          if (reads.length > 0) {
            const formattedReads = reads.map(
              (read) => `${read.sellerName}: ${read.reasoning}`,
            );
            peerReasoning.set(`${claim.id}:${persona.slug}`, formattedReads);
            const paidUsdc = reads.reduce(
              (sum, read) => sum + atomicToUsdc(read.pricePaidAtomic ?? "0"),
              0,
            );
            console.log(
              `[council:${persona.slug}] bought ${reads.length} peer read(s) for claim #${claim.id} ` +
              `(${paidUsdc.toFixed(6)} USDC)`,
            );
          }
        }
        const receipt = await runPersonaForClaim(persona, claim, ctx);
        if (receipt) stakesThisCycle += 1;
      } catch (err) {
        console.error(
          `[council:${persona.slug}] error on claim #${claim.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
      if (DECISION_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, DECISION_DELAY_MS));
      }
    }
  }

  console.log(
    stakesThisCycle > 0
      ? `[council] Cycle complete — ${stakesThisCycle} new stakes submitted.`
      : "[council] Cycle complete — no new stakes.",
  );
}

// ── Entry ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Council — 10 AI personas as economic actors");
  console.log(`  Contract       : ${CONTRACT_ADDRESS}`);
  console.log(`  Network        : Arc Testnet (${arcTestnet.id})`);
  console.log(`  LLM            : ${activeLLMProvider()} / ${activeLLMModel()} · key=${activeLLMKeyFingerprint()}`);
  console.log(`  Active personas: ${ACTIVE_PERSONAS.length} / ${COUNCIL_PERSONAS.length}`);
  console.log(`  Max claims/cycle: ${MAX_CLAIMS_PER_CYCLE}`);
  console.log(`  Decision gap   : ${DECISION_DELAY_MS / 1000}s`);
  console.log(`  Peer reads     : ${PEER_READS_ENABLED ? `${PEER_READS_PER_PERSONA}/persona via ${PEER_READS_BASE_URL}` : "off"}`);
  console.log(`  Peer read gap  : ${PEER_READ_DELAY_MS / 1000}s`);
  console.log(`  Poll every     : ${POLL_INTERVAL_MS / 1000}s`);
  console.log("───────────────────────────────────────────────");

  for (const p of ACTIVE_PERSONAS) {
    const addr = process.env[personaAddressEnv(p)] as `0x${string}`;
    const bal  = await publicClient.getBalance({ address: addr }).catch(() => 0n);
    console.log(
      `  ${p.emoji} ${p.displayName.padEnd(22)} ${addr.slice(0, 6)}…${addr.slice(-4)} · ${weiToUsdc(bal).toFixed(2)} USDC`,
    );
  }
  console.log("═══════════════════════════════════════════════\n");

  const safePoll = async () => {
    try {
      await poll();
    } catch (err) {
      console.error("[council] poll failed, will retry next interval:", err);
    }
  };

  await safePoll();
  setInterval(safePoll, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[council] fatal:", err);
  process.exit(1);
});
