#!/usr/bin/env node
/**
 * Regenerates lib/mimir-v3-abi.ts from the compiled artifact.
 *
 * The ABI is committed rather than read from artifacts/ at runtime, because
 * artifacts/ is build output and is not in the repo: importing it would work
 * locally and break every clean checkout.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = path.join(root, "artifacts", "MimirV3.abi.json");

if (!existsSync(artifact)) {
  execFileSync(process.execPath, [path.join(root, "scripts", "compile-contract.mjs"), "MimirV3"], {
    cwd: root,
    stdio: "inherit",
  });
}

const abi = JSON.parse(readFileSync(artifact, "utf8"));
const header = `/**
 * MimirV3 ABI, generated from artifacts/MimirV3.abi.json.
 *
 * Committed rather than read from artifacts/ at runtime: the artifacts
 * directory is build output and is not in the repo, so importing it would work
 * locally and break every clean checkout.
 *
 * Regenerate with: npm run abi:v3
 */
export const MIMIR_V3_ABI = `;

writeFileSync(path.join(root, "lib", "mimir-v3-abi.ts"), `${header}${JSON.stringify(abi, null, 2)} as const;\n`);
console.log(`lib/mimir-v3-abi.ts written (${abi.length} entries)`);
