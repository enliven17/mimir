/**
 * End-to-end demo of the full Mimir cycle on Arc Testnet with Gemini settling.
 *
 *   1. market-creator W3S wallet  → createClaim (2 USDC stake, 90s deadline)
 *   2. oracle W3S wallet          → challengeClaim (2 USDC counter-stake)
 *   3. wait for deadline
 *   4. oracle W3S wallet (Gemini) → resolveClaim with on-chain payout
 *
 * Run: npx tsx --env-file=.env.local scripts/demo-full-cycle.ts
 */

import { keccak256, toBytes, formatEther } from "viem";
import {
  createArcPublicClient, getContractAddress, getExplorerTxUrl, weiToUsdc, usdcToWei,
} from "../lib/arc";
import {
  executeContract, buildAbiFunctionSignature, toCircleAbiParameters,
  getOracleWalletId, getOracleAddress,
  getMarketCreatorWalletId, getMarketCreatorAddress,
} from "../lib/circle-w3s";
import { callLLM, activeLLMProvider, activeLLMModel } from "../lib/llm";
import { MIMIR_ABI, STATE, WINNER_SIDE } from "../lib/mimir-abi";

const DEADLINE_SECONDS = 150; // ≥ CHALLENGE_LOCK_SECONDS (60) + room for the challenge tx
const STAKE_USDC       = 2;
const SIG_CREATE       = buildAbiFunctionSignature("createClaim",     MIMIR_ABI);
const SIG_CHALLENGE    = buildAbiFunctionSignature("challengeClaim",  MIMIR_ABI);
const SIG_RESOLVE      = buildAbiFunctionSignature("resolveClaim",    MIMIR_ABI);

async function main(): Promise<void> {
  const client          = createArcPublicClient();
  const contractAddress = getContractAddress();
  const oracleWallet    = getOracleWalletId();
  const oracleAddr      = getOracleAddress();
  const creatorWallet   = getMarketCreatorWalletId();
  const creatorAddr     = getMarketCreatorAddress();

  console.log("─── Mimir full-cycle demo ───");
  console.log(`Contract: ${contractAddress}`);
  console.log(`LLM     : ${activeLLMProvider()} / ${activeLLMModel()}`);
  console.log(`Creator : ${creatorAddr}`);
  console.log(`Oracle  : ${oracleAddr}`);

  const stakeWei = usdcToWei(STAKE_USDC);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  // 1. CREATE
  console.log(`\n[1/4] Creating claim (deadline in ${DEADLINE_SECONDS}s)…`);
  const createTx = await executeContract({
    walletId:             creatorWallet,
    contractAddress,
    abiFunctionSignature: SIG_CREATE,
    abiParameters: toCircleAbiParameters([
      "Mimir demo — is the Bitcoin price > $100,000 USD?",
      "Yes, BTC > $100k",
      "No, BTC < $100k",
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      deadline,
      stakeWei,
      "crypto",
      0n, "binary", "pool", 0n, "",
      "Settle from CoinGecko BTC USD spot price at deadline",
      100n, false, "",
    ]),
    amount: String(STAKE_USDC),
    refId:  `demo-create-${Date.now()}`,
  });
  console.log(`     create tx: ${getExplorerTxUrl(createTx)}`);

  const newClaimId = (await client.readContract({
    address: contractAddress, abi: MIMIR_ABI, functionName: "claimCount",
  })) as bigint;
  const claimId = Number(newClaimId);
  console.log(`     claim id : #${claimId}`);

  // 2. CHALLENGE — oracle stakes on the opposite side
  console.log(`\n[2/4] Oracle challenges (stakes ${STAKE_USDC} USDC on Side B)…`);
  const challengeTx = await executeContract({
    walletId:             oracleWallet,
    contractAddress,
    abiFunctionSignature: SIG_CHALLENGE,
    abiParameters:        toCircleAbiParameters([BigInt(claimId), stakeWei, ""]),
    amount:               String(STAKE_USDC),
    refId:                `demo-challenge-${claimId}`,
  });
  console.log(`     challenge tx: ${getExplorerTxUrl(challengeTx)}`);

  // 3. WAIT
  const sleepMs = (DEADLINE_SECONDS + 5) * 1000;
  console.log(`\n[3/4] Waiting ${sleepMs / 1000}s for deadline…`);
  await new Promise((r) => setTimeout(r, sleepMs));

  // Confirm state is ACTIVE and deadline passed
  const claim = await client.readContract({
    address: contractAddress, abi: MIMIR_ABI, functionName: "getClaim", args: [BigInt(claimId)],
  }) as readonly any[];
  const stateNow = Number(claim[9]);
  console.log(`     state    : ${stateNow} (1=ACTIVE expected)`);
  if (stateNow !== STATE.ACTIVE) throw new Error("Claim not ACTIVE — challenge may have failed");

  // 4. RESOLVE — Gemini evaluates evidence, oracle calls resolveClaim
  console.log("\n[4/4] Fetching evidence + asking Gemini for verdict…");
  const evidenceUrl = claim[4] as string;
  const evidence = await fetchEvidence(evidenceUrl);
  console.log(`     evidence : ${evidence.slice(0, 120)}…`);

  const prompt = `You are Mimir, an impartial AI oracle for a prediction market.

Claim: ${claim[1]}
Side A (creator): ${claim[2]}
Side B (challenger): ${claim[3]}
Resolution source: ${evidenceUrl}
Settlement rule: ${claim[11] || "Use the resolution source to decide."}

Evidence fetched from the source:
<evidence>
${evidence}
</evidence>

Return JSON only:
{ "verdict": "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE",
  "confidence": <0-100>,
  "explanation": "<one sentence>" }`;

  const text = await callLLM(prompt, { maxTokens: 512, jsonOnly: true });
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM did not return JSON: ${text.slice(0, 200)}`);
  const verdict = JSON.parse(match[0]) as { verdict: keyof typeof WINNER_SIDE | string; confidence: number; explanation: string };
  console.log(`     verdict  : ${verdict.verdict} (${verdict.confidence}%)`);
  console.log(`     reason   : ${verdict.explanation}`);

  const sideMap: Record<string, number> = {
    CREATOR_WINS:    WINNER_SIDE.CREATOR,
    CHALLENGERS_WIN: WINNER_SIDE.CHALLENGERS,
    DRAW:            WINNER_SIDE.DRAW,
    UNRESOLVABLE:    WINNER_SIDE.UNRESOLVABLE,
  };
  const side = sideMap[verdict.verdict] ?? WINNER_SIDE.UNRESOLVABLE;
  const evidenceHash = keccak256(toBytes(evidence));

  console.log("     submitting resolveClaim via W3S…");
  const resolveTx = await executeContract({
    walletId:             oracleWallet,
    contractAddress,
    abiFunctionSignature: SIG_RESOLVE,
    abiParameters: toCircleAbiParameters([
      BigInt(claimId),
      side,
      verdict.explanation.slice(0, 400),
      Math.max(0, Math.min(100, Math.round(verdict.confidence ?? 50))),
      evidenceHash,
    ]),
    refId: `demo-resolve-${claimId}`,
  });
  console.log(`     resolve tx: ${getExplorerTxUrl(resolveTx)}`);

  // Post-state
  const final = await client.readContract({
    address: contractAddress, abi: MIMIR_ABI, functionName: "getClaim", args: [BigInt(claimId)],
  }) as readonly any[];
  const finalState = Number(final[9]);
  const winnerSide = Number(final[10]);
  const oracleBal  = await client.getBalance({ address: oracleAddr });
  const creatorBal = await client.getBalance({ address: creatorAddr });

  console.log("\n─── Final state ───");
  console.log(`Claim #${claimId} state: ${finalState === STATE.RESOLVED ? "RESOLVED" : finalState}`);
  console.log(`Winner side          : ${winnerSide} (1=creator, 2=challengers, 3=draw, 4=unresolvable)`);
  console.log(`Oracle  balance      : ${weiToUsdc(oracleBal).toFixed(4)} USDC`);
  console.log(`Creator balance      : ${weiToUsdc(creatorBal).toFixed(4)} USDC`);
  console.log("\n✓ Full Mimir cycle on Arc executed end-to-end (W3S + Gemini + native USDC).");
}

async function fetchEvidence(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mimir-Demo/1.0" }, signal: AbortSignal.timeout(15_000) });
    const txt = await res.text();
    return txt.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
  } catch (e: any) {
    return `(failed to fetch ${url}: ${e?.message ?? "unknown"})`;
  }
}

main().catch((e) => { console.error("\nDemo failed:", e?.message ?? e); process.exit(1); });
