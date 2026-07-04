/**
 * Compile + deploy Mimir.sol to Arc Testnet.
 *
 * Circle W3S developer wallets cannot deploy raw bytecode (no contractDeployment
 * endpoint). We bootstrap a fresh single-use deploy key, fund it from the
 * market-creator W3S wallet, deploy with vanilla viem, then immediately hand
 * ownership of the contract to the market-creator W3S address.
 *
 * Net result:
 *   - Contract owner = CIRCLE_CREATOR_ADDRESS (W3S managed)
 *   - Oracle         = CIRCLE_ORACLE_ADDRESS  (W3S managed)
 *   - Deploy key     = ephemeral, discarded after script exits
 *
 * Idempotent: aborts if NEXT_PUBLIC_CONTRACT_ADDRESS is already set.
 *
 * Run: npx tsx --env-file=.env.local scripts/deploy-mimir-w3s.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import solc from "solc";
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
import { MIMIR_ABI } from "../lib/mimir-abi";

const ENV_PATH        = resolve(process.cwd(), ".env.local");
const CONTRACT_PATH   = resolve(process.cwd(), "contracts/Mimir.sol");
const ARTIFACTS_DIR   = resolve(process.cwd(), "artifacts");
const BYTECODE_OUTPUT = resolve(ARTIFACTS_DIR, "Mimir.bin");

// 2 USDC funds the deploy + the transferOwnership tx; leftover dust stays on
// the ephemeral key (acceptable — value is < $0.10 worth of testnet USDC).
const DEPLOY_FUND_USDC = "2";

const DEPLOY_ABI = parseAbi(["constructor(address _oracle)"]);

interface SolcOutput {
  errors?: Array<{ severity: string; formattedMessage: string }>;
  contracts?: Record<string, Record<string, { evm: { bytecode: { object: string } } }>>;
}

function compile(): `0x${string}` {
  console.log(`Compiling ${CONTRACT_PATH}…`);
  const source = readFileSync(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: { "Mimir.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "*": ["evm.bytecode.object"] } },
    },
  };
  const output: SolcOutput = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = output.errors?.filter((e) => e.severity === "error") ?? [];
  if (fatal.length > 0) {
    fatal.forEach((e) => console.error(e.formattedMessage));
    throw new Error("Solidity compilation failed");
  }
  const warnings = output.errors?.filter((e) => e.severity === "warning") ?? [];
  if (warnings.length > 0) console.log(`  ${warnings.length} warning(s); proceeding`);

  const bytecodeRaw = output.contracts?.["Mimir.sol"]?.Mimir?.evm?.bytecode?.object;
  if (!bytecodeRaw) throw new Error("No bytecode for Mimir in solc output");
  if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(BYTECODE_OUTPUT, bytecodeRaw);
  console.log(`  ${bytecodeRaw.length / 2} bytes → artifacts/Mimir.bin`);
  return `0x${bytecodeRaw}` as `0x${string}`;
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
  if (new RegExp(`^#\\s*${key}=`, "m").test(raw)) {
    return raw.replace(new RegExp(`^#\\s*${key}=.*$`, "m"), `${key}=${value}`);
  }
  return raw.endsWith("\n") ? `${raw}${key}=${value}\n` : `${raw}\n${key}=${value}\n`;
}

async function main(): Promise<void> {
  const envRaw = readEnvRaw();
  const existing = readEnvVar(envRaw, "NEXT_PUBLIC_CONTRACT_ADDRESS") || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  if (existing && existing !== "0x0000000000000000000000000000000000000000") {
    console.log(`Mimir already deployed at ${existing}`);
    console.log("Clear NEXT_PUBLIC_CONTRACT_ADDRESS from .env.local to redeploy.");
    return;
  }

  const oracleAddr   = getOracleAddress();
  const ownerWallet  = getMarketCreatorWalletId();
  const ownerAddr    = getMarketCreatorAddress();

  // Sanity check — funder needs gas + the small deploy budget
  const arcPublic = createArcPublicClient();
  const ownerBalance = await arcPublic.getBalance({ address: ownerAddr });
  console.log("\nDeploy plan:");
  console.log(`  Funder (market-creator W3S) ${ownerAddr}`);
  console.log(`     balance: ${weiToUsdc(ownerBalance).toFixed(4)} USDC`);
  console.log(`  Final owner (same address)  ${ownerAddr}`);
  console.log(`  Oracle                      ${oracleAddr}\n`);
  if (ownerBalance < parseEther("3")) {
    throw new Error("Funder needs ≥3 USDC. Top up via faucet.circle.com.");
  }

  // 1. Compile
  const bytecode = compile();

  // 2. Spin up an ephemeral deploy key
  const deployPriv    = generatePrivateKey();
  const deployAccount = privateKeyToAccount(deployPriv);
  console.log(`\nEphemeral deploy key: ${deployAccount.address}`);
  console.log("  (in-memory only — discarded when this script exits)");

  // 3. Fund deploy key via W3S transfer
  console.log(`\nFunding deploy key with ${DEPLOY_FUND_USDC} USDC via W3S…`);
  const fundTx = await transferNative({
    walletId:           ownerWallet,
    blockchain:         "ARC-TESTNET",
    destinationAddress: deployAccount.address,
    amount:             DEPLOY_FUND_USDC,
    refId:              `deploy-fund-${Date.now()}`,
  });
  console.log(`  fund tx: ${getExplorerTxUrl(fundTx)}`);

  // Wait until deploy key actually has the funds (W3S may report tx earlier than indexing)
  const start = Date.now();
  let funded = 0n;
  while (Date.now() - start < 60_000) {
    funded = await arcPublic.getBalance({ address: deployAccount.address });
    if (funded >= parseEther("1")) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  console.log(`  deploy key balance: ${weiToUsdc(funded).toFixed(4)} USDC`);
  if (funded < parseEther("1")) throw new Error("Deploy key never received the funds");

  // 4. Deploy with vanilla viem
  console.log("\nDeploying Mimir.sol…");
  const deployWallet = createWalletClient({
    chain:     arcTestnet,
    transport: http(getArcRpcUrl()),
    account:   deployAccount,
  });
  const deployHash = await deployWallet.deployContract({
    abi:      DEPLOY_ABI,
    bytecode,
    args:     [oracleAddr],
  });
  const deployReceipt = await arcPublic.waitForTransactionReceipt({ hash: deployHash });
  if (deployReceipt.status !== "success") throw new Error("Deploy reverted");
  const contractAddress = deployReceipt.contractAddress;
  if (!contractAddress) throw new Error("No contractAddress in deploy receipt");
  console.log(`  contract: ${contractAddress}`);
  console.log(`  tx:       ${getExplorerTxUrl(deployHash)}`);

  // 5. Hand ownership to the market-creator W3S address
  console.log("\nTransferring contract ownership to W3S address…");
  const ownerTxHash = await deployWallet.writeContract({
    address:      contractAddress,
    abi:          MIMIR_ABI,
    functionName: "transferOwnership",
    args:         [ownerAddr],
    chain:        arcTestnet,
  });
  await arcPublic.waitForTransactionReceipt({ hash: ownerTxHash });
  console.log(`  ownership tx: ${getExplorerTxUrl(ownerTxHash)}`);

  // 6. Persist contract address
  const updated = upsertEnv(envRaw, "NEXT_PUBLIC_CONTRACT_ADDRESS", contractAddress);
  writeFileSync(ENV_PATH, updated);

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("DEPLOYED");
  console.log("");
  console.log(`Contract: ${contractAddress}`);
  console.log(`Owner   : ${ownerAddr} (W3S)`);
  console.log(`Oracle  : ${oracleAddr} (W3S)`);
  console.log(`Explorer: ${getExplorerAddressUrl(contractAddress)}`);
  console.log("");
  console.log("NEXT_PUBLIC_CONTRACT_ADDRESS written to .env.local");
  console.log("────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\nDeploy failed:", err?.message ?? err);
  process.exit(1);
});
