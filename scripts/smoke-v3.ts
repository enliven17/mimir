/**
 * Live end-to-end check of the deployed MimirV3, on chain, with real USDC.
 *
 * Opens a market, challenges it from a second wallet, settles it, then verifies
 * the thing the whole contract exists to get right: the winner received their
 * principal plus profit minus exactly the fee the policy says, and the fee is
 * claimable rather than stuck.
 *
 * Reads from the chain rather than trusting return values, because a settlement
 * that "succeeded" while paying the wrong amount is the failure worth catching.
 *
 * Run:
 *   npm run smoke:v3                 # the Arc V3 deploy (NEXT_PUBLIC_V3_CONTRACT_ADDRESS)
 *   npm run smoke:v3 -- base         # Base Sepolia (ERC-20 stakes, approve path)
 *   npm run smoke:v3 -- arbitrum --claim=4
 */

import { erc20Abi } from "viem";

import {
  executeContract,
  getMarketCreatorAddress,
  getOracleAddress,
} from "../lib/circle-w3s";
import { createChainPublicClient } from "../lib/arc";
import {
  CHAINS,
  explorerTxUrl,
  isChainKey,
  stakeUnitsToUsdc,
  usdcToStakeUnits,
  type ChainKey,
} from "../lib/chains";
import { requireWalletIdFor, w3sEscrowWrite } from "../lib/w3s-escrow";
import { MIMIR_V3_ABI } from "../lib/mimir-v3-abi";

const STAKE_USDC = 2;

const chain: ChainKey = (() => {
  const raw = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "arc").toLowerCase();
  if (!isChainKey(raw)) throw new Error(`unknown chain "${raw}" (arc | base | arbitrum)`);
  return raw;
})();
const cfg = CHAINS[chain];
const fmt = (units: bigint) => stakeUnitsToUsdc(chain, units).toFixed(6);
/** Challenges are locked out in the last 60s, so the deadline needs headroom. */
const DEADLINE_SECONDS = 180;

function contractAddress(): `0x${string}` {
  // On Arc the V3 deploy sits beside the live v2 escrow until cutover.
  const addr =
    chain === "arc" ? process.env.NEXT_PUBLIC_V3_CONTRACT_ADDRESS?.trim() : cfg.contractAddress;
  if (!addr) throw new Error(`No MimirV3 on ${cfg.name}; run npm run deploy:v3 -- ${chain} first`);
  return addr as `0x${string}`;
}

function challengerWallet(): { walletId: string; address: `0x${string}` } {
  const walletId = requireWalletIdFor("CIRCLE_ALICE_WALLET_ID", chain);
  const address = process.env.CIRCLE_ALICE_ADDRESS?.trim();
  if (!address) throw new Error("CIRCLE_ALICE_ADDRESS is required");
  return { walletId, address: address as `0x${string}` };
}

/** USDC held by `address`: native balance on Arc, the ERC-20 elsewhere. */
function usdcBalance(client: ReturnType<typeof createChainPublicClient>, address: `0x${string}`) {
  return cfg.stakeMode === "native"
    ? client.getBalance({ address })
    : client.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry a read against the RPC.
 *
 * The public Arc endpoint drops connections often enough that a single failed
 * `eth_getBalance` would otherwise abandon a market that is already funded and
 * waiting to settle.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.log(`   ${label} failed (attempt ${i + 1}/${attempts}), retrying…`);
      await sleep(2_000 * (i + 1));
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const mimir = contractAddress();
  const client = createChainPublicClient(chain);
  const creatorWallet = requireWalletIdFor("CIRCLE_CREATOR_WALLET_ID", chain);
  const creatorAddr = getMarketCreatorAddress();
  const oracleWallet = requireWalletIdFor("CIRCLE_ORACLE_WALLET_ID", chain);
  const challenger = challengerWallet();

  const [platformBps, agentBps, platformRecipient] = (await withRetry("feePolicy", () =>
    client.readContract({ address: mimir, abi: MIMIR_V3_ABI, functionName: "feePolicy" }),
  )) as [number, number, `0x${string}`];

  console.log(`MimirV3 smoke test on ${cfg.name}`);
  console.log(`  contract   : ${mimir}`);
  console.log(`  creator    : ${creatorAddr}`);
  console.log(`  challenger : ${challenger.address}`);
  console.log(`  oracle     : ${getOracleAddress()}`);
  console.log(`  fee policy : ${platformBps} bps platform + ${agentBps} bps agent owner`);
  console.log(`  recipient  : ${platformRecipient}\n`);

  for (const [label, addr] of [
    ["creator", creatorAddr],
    ["challenger", challenger.address],
  ] as const) {
    const bal = await withRetry(`${label} balance`, () => usdcBalance(client, addr));
    console.log(`  ${label} balance: ${fmt(bal)} USDC`);
    if (bal < usdcToStakeUnits(chain, 3)) throw new Error(`${label} needs at least 3 USDC on ${cfg.name}`);
  }

  const stake = usdcToStakeUnits(chain, STAKE_USDC);
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;

  // Resume an already-funded market rather than opening another one: a transient
  // RPC failure between challenge and settle should not cost two more stakes.
  const resumeId = process.argv.find((a) => a.startsWith("--claim="))?.split("=")[1];

  let claimId: bigint;

  if (resumeId) {
    claimId = BigInt(resumeId);
    console.log(`\nResuming claim ${claimId}: it is already funded, so create and challenge are skipped.`);
  } else {
  // ── 1. Create ────────────────────────────────────────────────────────────
  console.log("\n1. Creating a market…");
  // Through w3sEscrowWrite so the ERC-20 approve path is exercised on Base/Arbitrum.
  const createTx = await w3sEscrowWrite({
    chain,
    walletId: creatorWallet,
    owner: creatorAddr,
    functionName: "createClaim",
    escrow: { address: mimir, abiVersion: "v3" },
    stakeUsdc: STAKE_USDC,
    args: [
      "MimirV3 smoke test: does settlement pay the right amount?",
      "yes",
      "no",
      "https://example.com/smoke",
      deadline.toString(),
      stake.toString(),
      "custom",
      "0",
      "binary",
      "pool",
      "0",
      "",
      "Settled by the smoke test, not by evidence.",
      "0",
      false,
      "",
    ],
    // Attribute the creator side to an agent owner so the second fee leg is
    // exercised too. The challenger address stands in for an agent owner here.
    agentOwner: challenger.address,
    refId: `smoke-v3-create-${Date.now()}`,
  });
  console.log(`   tx: ${explorerTxUrl(chain, createTx)}`);

  claimId = (await withRetry("claimCount", () =>
    client.readContract({ address: mimir, abi: MIMIR_V3_ABI, functionName: "claimCount" }),
  )) as bigint;
  console.log(`   claim id: ${claimId}`);

  // ── 2. Challenge ─────────────────────────────────────────────────────────
  console.log("\n2. Challenging from the second wallet…");
  const challengeTx = await w3sEscrowWrite({
    chain,
    walletId: challenger.walletId,
    owner: challenger.address,
    functionName: "challengeClaim",
    escrow: { address: mimir, abiVersion: "v3" },
    stakeUsdc: STAKE_USDC,
    args: [claimId, stake, ""],
    refId: `smoke-v3-challenge-${Date.now()}`,
  });
  console.log(`   tx: ${explorerTxUrl(chain, challengeTx)}`);

  // ── 3. Wait out the deadline ─────────────────────────────────────────────
  const waitMs = Math.max(0, deadline * 1000 - Date.now()) + 5_000;
  console.log(`\n3. Waiting ${Math.ceil(waitMs / 1000)}s for the deadline…`);
  await sleep(waitMs);
  }

  // ── 4. Settle ────────────────────────────────────────────────────────────
  console.log("\n4. Settling for the creator…");
  const creatorBefore = await withRetry("balance", () => usdcBalance(client, creatorAddr));
  const feesBefore = (await withRetry("accruedFees", () =>
    client.readContract({
      address: mimir,
      abi: MIMIR_V3_ABI,
      functionName: "accruedFees",
      args: [platformRecipient],
    }),
  )) as bigint;

  const settleTx = await executeContract({
    walletId: oracleWallet,
    contractAddress: mimir,
    abiFunctionSignature: "resolveClaim(uint256,uint8,string,uint8,bytes32)",
    abiParameters: [
      claimId.toString(),
      "1", // SIDE_CREATOR
      "Smoke test settlement.",
      "90",
      `0x${"11".repeat(32)}`,
    ],
    refId: `smoke-v3-settle-${Date.now()}`,
  });
  console.log(`   tx: ${explorerTxUrl(chain, settleTx)}`);

  // ── 5. Verify the arithmetic ─────────────────────────────────────────────
  console.log("\n5. Checking what actually moved…");
  const creatorAfter = await withRetry("balance", () => usdcBalance(client, creatorAddr));
  const feesAfter = (await withRetry("accruedFees", () =>
    client.readContract({
      address: mimir,
      abi: MIMIR_V3_ABI,
      functionName: "accruedFees",
      args: [platformRecipient],
    }),
  )) as bigint;

  const profit = stake; // gross 2x stake, principal is the stake

  // "Nobody pays themselves": a leg whose recipient is the winner is waived
  // rather than taken and handed straight back. The creator wins here, so if the
  // platform recipient is the creator's own address that leg is zero by design,
  // and expecting otherwise would be testing the wrong contract.
  const platformIsWinner = platformRecipient.toLowerCase() === creatorAddr.toLowerCase();
  const expectedPlatformFee = platformIsWinner ? 0n : (profit * BigInt(platformBps)) / 10_000n;
  const expectedAgentFee = (profit * BigInt(agentBps)) / 10_000n;
  const received = creatorAfter - creatorBefore;

  if (platformIsWinner) {
    console.log("   note: the platform recipient is the winning wallet, so that leg is waived");
  }

  console.log(`   creator received : ${fmt(received)} USDC`);
  console.log(`   platform fee     : ${fmt(feesAfter - feesBefore)} USDC (expected ${fmt(expectedPlatformFee)})`);

  const agentFee = (await client.readContract({
    address: mimir,
    abi: MIMIR_V3_ABI,
    functionName: "accruedFees",
    args: [challenger.address],
  })) as bigint;
  console.log(`   agent owner fee  : ${fmt(agentFee)} USDC (expected ${fmt(expectedAgentFee)})`);

  const failures: string[] = [];
  if (received < stake) failures.push("the winner received less than their principal");
  if (received !== stake * 2n - expectedPlatformFee - expectedAgentFee) {
    failures.push("the winner did not receive gross minus exactly the policy fees");
  }
  if (feesAfter - feesBefore !== expectedPlatformFee) failures.push("the platform fee is not the policy amount");
  if (agentFee < expectedAgentFee) failures.push("the agent owner fee did not accrue");

  const escrowBalance = await usdcBalance(client, mimir);
  const [accrued, claimed] = (await client.readContract({
    address: mimir,
    abi: MIMIR_V3_ABI,
    functionName: "getFeeStats",
  })) as [bigint, bigint, bigint];
  console.log(`   escrow balance   : ${fmt(escrowBalance)} USDC`);
  console.log(`   fees outstanding : ${fmt(accrued - claimed)} USDC`);
  if (escrowBalance < accrued - claimed) {
    failures.push("the escrow holds less than it owes in fees");
  }

  // ── 6. Pull an accrued fee ───────────────────────────────────────────────
  // Claimed from whichever leg actually accrued and whose wallet this script
  // controls, so the pull path is exercised rather than assumed.
  const claimant =
    agentFee > 0n
      ? { label: "agent owner", walletId: challenger.walletId, address: challenger.address }
      : platformIsWinner
        ? null
        : { label: "platform", walletId: creatorWallet, address: creatorAddr };

  if (claimant) {
    console.log(`\n6. Claiming the ${claimant.label} fee…`);
    const claimTx = await executeContract({
      walletId: claimant.walletId,
      contractAddress: mimir,
      abiFunctionSignature: "claimFees()",
      abiParameters: [],
      refId: `smoke-v3-claim-${Date.now()}`,
    });
    console.log(`   tx: ${explorerTxUrl(chain, claimTx)}`);
    const left = (await withRetry("accruedFees", () =>
      client.readContract({
        address: mimir,
        abi: MIMIR_V3_ABI,
        functionName: "accruedFees",
        args: [claimant.address],
      }),
    )) as bigint;
    console.log(`   remaining accrued: ${fmt(left)} USDC`);
    if (left !== 0n) failures.push("claimFees did not clear the balance");
  } else {
    console.log("\n6. Nothing accrued to a wallet this script controls, skipping the claim.");
  }

  console.log("\n────────────────────────────────────────────");
  if (failures.length === 0) {
    console.log("PASS: settlement paid the policy amount and the fee is claimable.");
  } else {
    console.log("FAIL:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
  console.log("────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\nSmoke test failed:", err?.message ?? err);
  process.exit(1);
});
