/**
 * Compile + deploy MimirV3.sol to Arc Testnet.
 *
 * Circle W3S developer wallets cannot deploy raw bytecode, so this bootstraps a
 * single-use deploy key, funds it from the market-creator W3S wallet, deploys
 * with vanilla viem, then hands ownership to the market-creator W3S address.
 * The ephemeral key is in memory only and is discarded when the script exits.
 *
 * The result is written to NEXT_PUBLIC_V3_CONTRACT_ADDRESS, deliberately **not**
 * NEXT_PUBLIC_CONTRACT_ADDRESS: v2 keeps serving the live market history until
 * someone decides to cut over. A deploy that silently repoints the app would
 * strand every open position on an address the UI no longer reads.
 *
 * Run: npx tsx --env-file=.env.local scripts/deploy-mimir-v3.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createWalletClient, http, parseAbi, parseEther, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  transferNative,
  getMarketCreatorWalletId,
  getMarketCreatorAddress,
  getOracleAddress,
} from "../lib/circle-w3s";
import {
  arcTestnet,
  createArcPublicClient,
  getArcRpcUrl,
  weiToUsdc,
  getExplorerTxUrl,
  getExplorerAddressUrl,
} from "../lib/arc";
import { MIMIR_V3_ABI } from "../lib/mimir-v3-abi";
import { MAX_TOTAL_FEE_BPS } from "../lib/fees";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const ARTIFACTS_DIR = resolve(process.cwd(), "artifacts");
const BYTECODE_PATH = resolve(ARTIFACTS_DIR, "MimirV3.bin");
const RUNTIME_PATH = resolve(ARTIFACTS_DIR, "MimirV3.runtime.bin");

/** Funds the deploy plus the ownership transfer. Leftover dust stays on the ephemeral key. */
const DEPLOY_FUND_USDC = "2";

const DEPLOY_ABI = parseAbi([
  "constructor(address _oracle, uint16 _platformFeeBps, uint16 _agentOwnerFeeBps, address _platformRecipient)",
]);

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
  const envRaw = readEnvRaw();
  const existing =
    readEnvVar(envRaw, "NEXT_PUBLIC_V3_CONTRACT_ADDRESS") ??
    process.env.NEXT_PUBLIC_V3_CONTRACT_ADDRESS;
  if (existing && existing !== "0x0000000000000000000000000000000000000000") {
    console.log(`MimirV3 already deployed at ${existing}`);
    console.log("Clear NEXT_PUBLIC_V3_CONTRACT_ADDRESS from .env.local to redeploy.");
    return;
  }

  const oracleAddr = getOracleAddress();
  const ownerWallet = getMarketCreatorWalletId();
  const ownerAddr = getMarketCreatorAddress();

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

  const arcPublic = createArcPublicClient();
  const ownerBalance = await arcPublic.getBalance({ address: ownerAddr });

  console.log("\nDeploy plan:");
  console.log(`  Funder / final owner  ${ownerAddr} (W3S)`);
  console.log(`     balance:           ${weiToUsdc(ownerBalance).toFixed(4)} USDC`);
  console.log(`  Oracle                ${oracleAddr} (W3S)`);
  console.log(`  Platform fee          ${platformFeeBps} bps of profit → ${platformRecipient}`);
  console.log(`  Agent owner fee       ${agentOwnerFeeBps} bps of profit → the attributed agent`);
  console.log(`  Fee changes           queued, then executable after 2 days, capped at ${MAX_TOTAL_FEE_BPS} bps\n`);

  if (ownerBalance < parseEther("3")) {
    throw new Error("Funder needs at least 3 USDC. Top up via faucet.circle.com.");
  }

  const { bytecode, runtime } = compile();

  const deployPriv = generatePrivateKey();
  const deployAccount = privateKeyToAccount(deployPriv);
  console.log(`\nEphemeral deploy key: ${deployAccount.address}`);
  console.log("  (in memory only, discarded when this script exits)");

  console.log(`\nFunding the deploy key with ${DEPLOY_FUND_USDC} USDC via W3S…`);
  const fundTx = await transferNative({
    walletId: ownerWallet,
    blockchain: "ARC-TESTNET",
    destinationAddress: deployAccount.address,
    amount: DEPLOY_FUND_USDC,
    refId: `deploy-v3-${Date.now()}`,
  });
  console.log(`  fund tx: ${getExplorerTxUrl(fundTx)}`);

  // W3S reports the transfer before the chain has it indexed, so wait on the balance.
  const start = Date.now();
  let funded = 0n;
  while (Date.now() - start < 90_000) {
    funded = await arcPublic.getBalance({ address: deployAccount.address });
    if (funded >= parseEther("1")) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  console.log(`  deploy key balance: ${weiToUsdc(funded).toFixed(4)} USDC`);
  if (funded < parseEther("1")) throw new Error("The deploy key never received the funds");

  console.log("\nDeploying MimirV3…");
  const deployWallet = createWalletClient({
    chain: arcTestnet,
    transport: http(getArcRpcUrl()),
    account: deployAccount,
  });
  const deployHash = await deployWallet.deployContract({
    abi: DEPLOY_ABI,
    bytecode,
    args: [oracleAddr, platformFeeBps, agentOwnerFeeBps, platformRecipient],
  });
  const receipt = await arcPublic.waitForTransactionReceipt({ hash: deployHash });
  if (receipt.status !== "success") throw new Error("Deploy reverted");
  const contractAddress = receipt.contractAddress;
  if (!contractAddress) throw new Error("No contractAddress in the deploy receipt");
  console.log(`  contract: ${contractAddress}`);
  console.log(`  block:    ${receipt.blockNumber}`);
  console.log(`  tx:       ${getExplorerTxUrl(deployHash)}`);

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

  console.log("\nTransferring ownership to the W3S address…");
  const ownerTx = await deployWallet.writeContract({
    address: contractAddress,
    abi: MIMIR_V3_ABI,
    functionName: "transferOwnership",
    args: [ownerAddr],
    chain: arcTestnet,
  });
  await arcPublic.waitForTransactionReceipt({ hash: ownerTx });
  console.log(`  ownership tx: ${getExplorerTxUrl(ownerTx)}`);

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

  let updated = upsertEnv(envRaw, "NEXT_PUBLIC_V3_CONTRACT_ADDRESS", contractAddress);
  updated = upsertEnv(updated, "NEXT_PUBLIC_V3_DEPLOY_BLOCK", receipt.blockNumber.toString());
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
  console.log(`Explorer   : ${getExplorerAddressUrl(contractAddress)}`);
  console.log("");
  console.log("Written to .env.local:");
  console.log("  NEXT_PUBLIC_V3_CONTRACT_ADDRESS");
  console.log("  NEXT_PUBLIC_V3_DEPLOY_BLOCK");
  console.log("");
  console.log("The app still reads v2. Cutting over is a separate, deliberate step:");
  console.log("  point NEXT_PUBLIC_CONTRACT_ADDRESS and NEXT_PUBLIC_DEPLOY_BLOCK at the values above,");
  console.log("  keep the old pair as NEXT_PUBLIC_LEGACY_*, then rebuild the read index.");
  console.log("────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\nDeploy failed:", err?.message ?? err);
  process.exit(1);
});
