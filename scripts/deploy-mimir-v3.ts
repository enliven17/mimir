/**
 * Compile + deploy MimirV3.sol to Arc Testnet, Base Sepolia or Arbitrum Sepolia.
 *
 *   npm run deploy:v3               # Arc (native USDC stakes)
 *   npm run deploy:v3 -- base       # Base Sepolia (ERC-20 USDC stakes)
 *   npm run deploy:v3 -- arbitrum   # Arbitrum Sepolia (ERC-20 USDC stakes)
 *
 * Circle W3S developer wallets cannot deploy raw bytecode, so this bootstraps a
 * single-use deploy key, funds it from the market-creator W3S wallet, deploys
 * with vanilla viem, then hands ownership to the market-creator W3S address.
 * The ephemeral key is in memory only and is discarded when the script exits.
 *
 * On Arc the result is written to NEXT_PUBLIC_V3_CONTRACT_ADDRESS, deliberately
 * **not** NEXT_PUBLIC_CONTRACT_ADDRESS: v2 keeps serving the live market history
 * until someone decides to cut over. A deploy that silently repoints the app
 * would strand every open position on an address the UI no longer reads.
 *
 * Base and Arbitrum have no earlier escrow, so there the result goes straight to
 * NEXT_PUBLIC_<CHAIN>_CONTRACT_ADDRESS / _DEPLOY_BLOCK and enables the chain.
 * The funder there is the market creator's derived W3S wallet
 * (CIRCLE_CREATOR_WALLET_ID_<CHAIN>, see npm run circle:derive-wallets), paying
 * gas in Sepolia ETH.
 *
 * Run: npx tsx --env-file=.env.local scripts/deploy-mimir-v3.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createWalletClient, http, parseAbi, parseEther, formatEther, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  executeContract,
  transferNative,
  getMarketCreatorAddress,
  getOracleAddress,
} from "../lib/circle-w3s";
import { createChainPublicClient } from "../lib/arc";
import {
  CHAINS,
  explorerAddressUrl,
  explorerTxUrl,
  isChainKey,
  type ChainKey,
} from "../lib/chains";
import { requireWalletIdFor } from "../lib/w3s-escrow";
import { MIMIR_V3_ABI } from "../lib/mimir-v3-abi";
import { MAX_TOTAL_FEE_BPS } from "../lib/fees";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const ARTIFACTS_DIR = resolve(process.cwd(), "artifacts");
const BYTECODE_PATH = resolve(ARTIFACTS_DIR, "MimirV3.bin");
const RUNTIME_PATH = resolve(ARTIFACTS_DIR, "MimirV3.runtime.bin");

/**
 * Funds the deploy plus the ownership transfer, in the chain's gas token.
 * Leftover dust stays on the ephemeral key.
 */
const DEPLOY_FUND: Record<"native-usdc" | "eth", { send: string; min: string; need: string }> = {
  "native-usdc": { send: "2", min: "1", need: "3" },
  eth: { send: "0.004", min: "0.002", need: "0.005" },
};

const DEPLOY_ABI = parseAbi([
  "constructor(address _oracle, uint16 _platformFeeBps, uint16 _agentOwnerFeeBps, address _platformRecipient, address _usdc)",
]);

function targetChain(): ChainKey {
  const raw = (process.argv[2] ?? process.env.DEPLOY_CHAIN ?? "arc").trim().toLowerCase();
  if (!isChainKey(raw)) throw new Error(`unknown chain "${raw}" (arc | base | arbitrum)`);
  return raw;
}

/** Where the address is recorded. Arc keeps the cutover-safe V3 names. */
function envKeys(chain: ChainKey): { address: string; block: string } {
  if (chain === "arc") {
    return { address: "NEXT_PUBLIC_V3_CONTRACT_ADDRESS", block: "NEXT_PUBLIC_V3_DEPLOY_BLOCK" };
  }
  const up = chain.toUpperCase();
  return { address: `NEXT_PUBLIC_${up}_CONTRACT_ADDRESS`, block: `NEXT_PUBLIC_${up}_DEPLOY_BLOCK` };
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer`);
  return n;
}

function compile(): { bytecode: `0x${string}`; runtime: string } {
  console.log("Compiling contracts/MimirV3.sol…");
  execFileSync(process.execPath, [resolve("scripts/compile-contract.mjs"), "MimirV3"], {
    stdio: "inherit",
  });
  if (!existsSync(BYTECODE_PATH)) throw new Error("compile produced no MimirV3.bin");
  const bytecode = readFileSync(BYTECODE_PATH, "utf8").trim();
  const runtime = readFileSync(RUNTIME_PATH, "utf8").trim();
  return { bytecode: `0x${bytecode}` as `0x${string}`, runtime };
}

function readEnvRaw(): string {
  return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
}

function readEnvVar(raw: string, key: string): string | undefined {
  const m = raw.match(new RegExp(`^${key}=(.+?)$`, "m"));
  return m?.[1]?.trim();
}

function upsertEnv(raw: string, key: string, value: string): string {
  if (new RegExp(`^${key}=`, "m").test(raw)) {
    return raw.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  }
  return raw.endsWith("\n") ? `${raw}${key}=${value}\n` : `${raw}\n${key}=${value}\n`;
}

async function main(): Promise<void> {
  const chain = targetChain();
  const cfg = CHAINS[chain];
  const keys = envKeys(chain);
  const envRaw = readEnvRaw();
  const existing = readEnvVar(envRaw, keys.address) ?? process.env[keys.address];
  if (existing && existing !== "0x0000000000000000000000000000000000000000") {
    console.log(`MimirV3 already deployed on ${cfg.name} at ${existing}`);
    console.log(`Clear ${keys.address} from .env.local to redeploy.`);
    return;
  }

  const oracleAddr = getOracleAddress();
  const ownerWallet = requireWalletIdFor("CIRCLE_CREATOR_WALLET_ID", chain);
  const ownerAddr = getMarketCreatorAddress();
  // Native mode on Arc (USDC is the gas token), ERC-20 mode everywhere else.
  const stakeToken =
    cfg.stakeMode === "native" ? "0x0000000000000000000000000000000000000000" : cfg.usdc;
  const fund = DEPLOY_FUND[cfg.stakeMode === "native" ? "native-usdc" : "eth"];
  const gas = cfg.gasSymbol;

  const platformFeeBps = envNumber("V3_PLATFORM_FEE_BPS", 50);
  const agentOwnerFeeBps = envNumber("V3_AGENT_OWNER_FEE_BPS", 50);
  const platformRecipient = getAddress(
    process.env.PLATFORM_FEE_RECIPIENT?.trim() ||
      process.env.X402_SELLER_ADDRESS?.trim() ||
      ownerAddr,
  );

  if (platformFeeBps + agentOwnerFeeBps > MAX_TOTAL_FEE_BPS) {
    throw new Error(
      `fee legs total ${platformFeeBps + agentOwnerFeeBps} bps, above the ${MAX_TOTAL_FEE_BPS} bps cap`,
    );
  }

  const arcPublic = createChainPublicClient(chain);
  const ownerBalance = await arcPublic.getBalance({ address: ownerAddr });

  console.log(`\nDeploy plan (${cfg.name}):`);
  console.log(`  Funder / final owner  ${ownerAddr} (W3S)`);
  console.log(`     balance:           ${Number(formatEther(ownerBalance)).toFixed(4)} ${gas}`);
  console.log(
    `  Stake asset           ${cfg.stakeMode === "native" ? "native USDC (msg.value)" : `USDC ERC-20 ${stakeToken}`}`,
  );
  console.log(`  Oracle                ${oracleAddr} (W3S)`);
  console.log(`  Platform fee          ${platformFeeBps} bps of profit → ${platformRecipient}`);
  console.log(`  Agent owner fee       ${agentOwnerFeeBps} bps of profit → the attributed agent`);
  console.log(`  Fee changes           queued, then executable after 2 days, capped at ${MAX_TOTAL_FEE_BPS} bps\n`);

  if (ownerBalance < parseEther(fund.need)) {
    throw new Error(
      `Funder needs at least ${fund.need} ${gas} on ${cfg.name}. ` +
        (gas === "USDC" ? "Top up via faucet.circle.com." : "Use a Sepolia ETH faucet for this network."),
    );
  }

  const { bytecode, runtime } = compile();

  const deployPriv = generatePrivateKey();
  const deployAccount = privateKeyToAccount(deployPriv);
  console.log(`\nEphemeral deploy key: ${deployAccount.address}`);
  console.log("  (in memory only, discarded when this script exits)");

  console.log(`\nFunding the deploy key with ${fund.send} ${gas} via W3S…`);
  const fundTx = await transferNative({
    walletId: ownerWallet,
    blockchain: cfg.w3sBlockchain,
    destinationAddress: deployAccount.address,
    amount: fund.send,
    refId: `deploy-v3-${chain}-${Date.now()}`,
  });
  console.log(`  fund tx: ${explorerTxUrl(chain, fundTx)}`);

  // W3S reports the transfer before the chain has it indexed, so wait on the balance.
  const start = Date.now();
  let funded = 0n;
  while (Date.now() - start < 90_000) {
    funded = await arcPublic.getBalance({ address: deployAccount.address });
    if (funded >= parseEther(fund.min)) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  console.log(`  deploy key balance: ${Number(formatEther(funded)).toFixed(4)} ${gas}`);
  if (funded < parseEther(fund.min)) throw new Error("The deploy key never received the funds");

  console.log("\nDeploying MimirV3…");
  const deployWallet = createWalletClient({
    chain: cfg.chain,
    transport: http(cfg.rpcUrl),
    account: deployAccount,
  });
  const deployHash = await deployWallet.deployContract({
    abi: DEPLOY_ABI,
    bytecode,
    args: [oracleAddr, platformFeeBps, agentOwnerFeeBps, platformRecipient, stakeToken],
  });
  const receipt = await arcPublic.waitForTransactionReceipt({ hash: deployHash });
  if (receipt.status !== "success") throw new Error("Deploy reverted");
  const contractAddress = receipt.contractAddress;
  if (!contractAddress) throw new Error("No contractAddress in the deploy receipt");
  console.log(`  contract: ${contractAddress}`);
  console.log(`  block:    ${receipt.blockNumber}`);
  console.log(`  tx:       ${explorerTxUrl(chain, deployHash)}`);

  // Verify what actually landed on chain matches what was compiled here. A
  // deploy nobody checked is a deploy that can quietly be the wrong bytecode.
  const onChain = await arcPublic.getCode({ address: contractAddress });
  const deployedRuntime = (onChain ?? "0x").slice(2);
  if (deployedRuntime.length === 0) throw new Error("No code at the deployed address");
  if (deployedRuntime !== runtime) {
    // Metadata hashes can differ across solc invocations; compare the code body.
    const strip = (s: string) => s.slice(0, Math.max(0, s.length - 106));
    if (strip(deployedRuntime) !== strip(runtime)) {
      throw new Error("Deployed runtime bytecode does not match the local artifact");
    }
    console.log("  runtime matches (ignoring the trailing metadata hash)");
  } else {
    console.log("  runtime bytecode matches the local artifact exactly");
  }

  // Ownership is two-step. The final owner should be a multisig
  // (MIMIR_V3_OWNER), not the market-creator hot wallet that also trades:
  // the owner can queue an oracle change and pause new positions. Without
  // MIMIR_V3_OWNER the W3S market-creator wallet is used and accepts here.
  const finalOwner = process.env.MIMIR_V3_OWNER?.trim()
    ? getAddress(process.env.MIMIR_V3_OWNER.trim())
    : ownerAddr;
  console.log(`\nStarting the ownership transfer to ${finalOwner}…`);
  const ownerTx = await deployWallet.writeContract({
    address: contractAddress,
    abi: MIMIR_V3_ABI,
    functionName: "transferOwnership",
    args: [finalOwner],
    chain: cfg.chain,
  });
  await arcPublic.waitForTransactionReceipt({ hash: ownerTx });
  console.log(`  transferOwnership tx: ${explorerTxUrl(chain, ownerTx)}`);
  if (finalOwner === ownerAddr) {
    const acceptTx = await executeContract({
      walletId: ownerWallet,
      contractAddress,
      abiFunctionSignature: "acceptOwnership()",
      abiParameters: [],
    });
    console.log(`  acceptOwnership tx: ${explorerTxUrl(chain, acceptTx)}`);
  } else {
    console.log("  Pending: call acceptOwnership() from the multisig to finish the transfer.");
  }

  // Read the live policy back rather than trusting the constructor arguments.
  const [livePlatformBps, liveAgentBps, liveRecipient] = (await arcPublic.readContract({
    address: contractAddress,
    abi: MIMIR_V3_ABI,
    functionName: "feePolicy",
  })) as [number, number, string];
  const liveOwner = (await arcPublic.readContract({
    address: contractAddress,
    abi: MIMIR_V3_ABI,
    functionName: "owner",
  })) as string;

  const [liveUsdc, liveMinStake] = await Promise.all([
    arcPublic.readContract({ address: contractAddress, abi: MIMIR_V3_ABI, functionName: "usdc" }) as Promise<string>,
    arcPublic.readContract({ address: contractAddress, abi: MIMIR_V3_ABI, functionName: "MIN_STAKE" }) as Promise<bigint>,
  ]);
  if (liveUsdc.toLowerCase() !== stakeToken.toLowerCase()) {
    throw new Error(`Deployed stake asset ${liveUsdc} is not ${stakeToken}`);
  }

  let updated = upsertEnv(envRaw, keys.address, contractAddress);
  updated = upsertEnv(updated, keys.block, receipt.blockNumber.toString());
  writeFileSync(ENV_PATH, updated);

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("DEPLOYED");
  console.log("");
  console.log(`Contract   : ${contractAddress}`);
  console.log(`Block      : ${receipt.blockNumber}`);
  console.log(`Owner      : ${liveOwner}`);
  console.log(`Oracle     : ${oracleAddr}`);
  console.log(`Fee policy : ${livePlatformBps} bps platform + ${liveAgentBps} bps agent owner`);
  console.log(`Recipient  : ${liveRecipient}`);
  console.log(`Stake      : ${liveUsdc} (min ${liveMinStake})`);
  console.log(`Explorer   : ${explorerAddressUrl(chain, contractAddress)}`);
  console.log("");
  console.log("Written to .env.local:");
  console.log(`  ${keys.address}`);
  console.log(`  ${keys.block}`);
  console.log("");
  if (chain === "arc") {
    console.log("The app still reads v2 on Arc. Cutting over is a separate, deliberate step:");
    console.log("  point NEXT_PUBLIC_CONTRACT_ADDRESS and NEXT_PUBLIC_DEPLOY_BLOCK at the values above,");
    console.log("  set NEXT_PUBLIC_ARC_ABI_VERSION=v3, then rebuild the read index.");
  } else {
    console.log(`${cfg.name} is now enabled. Copy both values to Vercel + Railway and redeploy.`);
  }
  console.log("────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\nDeploy failed:", err?.message ?? err);
  process.exit(1);
});
