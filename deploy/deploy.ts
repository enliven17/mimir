/**
 * Mimir contract deployment script for Arc Testnet
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... ORACLE_ADDRESS=0x... npx tsx deploy/deploy.ts
 *
 * Or interactively (prompts for keys):
 *   npx tsx deploy/deploy.ts
 *
 * After deployment, set NEXT_PUBLIC_CONTRACT_ADDRESS in .env.local
 */

import { createInterface } from "readline";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import * as path from "path";
import { arcTestnet, getArcRpcUrl } from "../lib/arc";

// ── Mimir.sol constructor ABI ─────────────────────────────────────────────────
const DEPLOY_ABI = parseAbi(["constructor(address _oracle)"]);

function prompt(question: string, { mask = false } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      reject(new Error("No interactive terminal — set env vars directly."));
      return;
    }

    const rl = createInterface({
      input:  process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const mrl = rl as any;
    const origWrite = mrl._writeToOutput.bind(mrl);

    if (mask) {
      mrl._writeToOutput = (s: string) => {
        if (rl.line.length > 0) {
          mrl.output.write(`\r${question}${"*".repeat(rl.line.length)}`);
          return;
        }
        origWrite(s);
      };
    }

    rl.question(question, (answer) => {
      rl.close();
      if (mask) process.stdout.write("\n");
      resolve(answer.trim());
    });
    rl.once("SIGINT", () => { rl.close(); reject(new Error("Cancelled.")); });
  });
}

async function getKey(envVar: string, label: string): Promise<string> {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;
  return prompt(`Enter ${label} (0x...): `, { mask: true });
}

async function main() {
  const deployerKey = await getKey("DEPLOYER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY");
  const oracleAddr  = (process.env.ORACLE_ADDRESS?.trim() ||
    await prompt("Enter ORACLE_ADDRESS (0x...): ")).trim();

  if (!deployerKey.startsWith("0x")) throw new Error("Private key must start with 0x");
  if (!oracleAddr.startsWith("0x"))  throw new Error("Oracle address must start with 0x");

  const account = privateKeyToAccount(deployerKey as `0x${string}`);
  const rpc     = getArcRpcUrl();

  const wallet = createWalletClient({
    chain:     arcTestnet,
    transport: http(rpc),
    account,
  });

  const publicClient = createPublicClient({
    chain:     arcTestnet,
    transport: http(rpc),
  });

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log("  Mimir Contract Deployment");
  console.log(`  Network  : Arc Testnet (${arcTestnet.id})`);
  console.log(`  RPC      : ${rpc}`);
  console.log(`  Deployer : ${account.address}`);
  console.log(`  Oracle   : ${oracleAddr}`);
  console.log("═══════════════════════════════════════\n");

  // Read compiled bytecode if available, otherwise compile on-the-fly
  // For the hackathon, we include a pre-compiled bytecode path or use solc
  let bytecode: `0x${string}`;
  const bytecodePath = path.resolve(process.cwd(), "artifacts/Mimir.bin");
  try {
    bytecode = `0x${readFileSync(bytecodePath, "utf-8").trim()}`;
    console.log("Using pre-compiled bytecode from artifacts/Mimir.bin");
  } catch {
    throw new Error(
      "contracts/Mimir.sol must be compiled first.\n" +
      "Run: npx hardhat compile  (or use Foundry: forge build)\n" +
      "Then copy the bytecode to artifacts/Mimir.bin"
    );
  }

  console.log("Deploying...");

  const txHash = await wallet.deployContract({
    abi:      DEPLOY_ABI,
    bytecode,
    args:     [oracleAddr as `0x${string}`],
  });

  console.log(`Tx hash: ${txHash}`);
  console.log("Waiting for receipt...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "reverted") {
    throw new Error("Deployment transaction reverted!");
  }

  const contractAddress = receipt.contractAddress;
  console.log("");
  console.log("✓ Mimir deployed successfully!");
  console.log(`  Contract : ${contractAddress}`);
  console.log(`  Explorer : https://testnet.arcscan.app/address/${contractAddress}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Add to .env.local: NEXT_PUBLIC_CONTRACT_ADDRESS=${contractAddress}`);
  console.log("  2. Configure the oracle via Circle W3S (no local private key):");
  console.log("     CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_ORACLE_WALLET_ID, CIRCLE_ORACLE_ADDRESS");
  console.log("  3. npm run dev");
  console.log("  4. npm run oracle   (start the AI resolution agent)");
}

main().catch((err) => {
  console.error("Deploy failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
