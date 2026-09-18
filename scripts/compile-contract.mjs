#!/usr/bin/env node
/**
 * Compiles the Solidity sources with solc and writes artifacts/.
 *
 * Usage:
 *   node scripts/compile-contract.mjs            # every contract
 *   node scripts/compile-contract.mjs MimirV3    # one contract
 *
 * viaIR is on because the claim struct and the 17-argument createClaim put the
 * legacy pipeline over its stack limit.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = path.join(root, "contracts");
const outDir = path.join(root, "artifacts");

const only = process.argv[2];
const sources = {};
for (const file of readdirSync(contractsDir).filter((f) => f.endsWith(".sol"))) {
  if (only && path.basename(file, ".sol") !== only) continue;
  sources[file] = { content: readFileSync(path.join(contractsDir, file), "utf-8") };
}

if (Object.keys(sources).length === 0) {
  console.error(only ? `No contracts/${only}.sol` : "No contracts found");
  process.exit(1);
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    viaIR: true,
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
for (const e of output.errors ?? []) {
  console.log(e.formattedMessage ?? e.message);
}
if (errors.length > 0) {
  console.error(`\n${errors.length} compile error(s)`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
let written = 0;
for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [name, c] of Object.entries(contracts)) {
    writeFileSync(path.join(outDir, `${name}.abi.json`), JSON.stringify(c.abi, null, 2));
    writeFileSync(path.join(outDir, `${name}.bin`), c.evm.bytecode.object);
    writeFileSync(path.join(outDir, `${name}.runtime.bin`), c.evm.deployedBytecode.object);
    const size = c.evm.deployedBytecode.object.length / 2;
    console.log(`${name} (${file}): ${size} bytes runtime`);
    written++;
  }
}
console.log(`Wrote ${written} artifact set(s) to artifacts/`);
