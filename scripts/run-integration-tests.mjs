#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const pythonBin = process.env.PYTHON_BIN || "python";
const integrationDir = "tests/integration";

function printUsage() {
  console.log(`Usage:
  node scripts/run-integration-tests.mjs [--network <name>] [--python-bin <path>] [-- <pytest args...>]

Examples:
  node scripts/run-integration-tests.mjs
  node scripts/run-integration-tests.mjs --network localnet
  node scripts/run-integration-tests.mjs --network studionet -- --collect-only

Environment overrides:
  PYTHON_BIN=python3 node scripts/run-integration-tests.mjs --network localnet
`);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
let network = "";
let explicitPythonBin = "";
let passthroughArgs = [];

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];

  if (arg === "--help" || arg === "-h") {
    printUsage();
    process.exit(0);
  }

  if (arg === "--network") {
    network = argv[i + 1] ?? "";
    i += 1;
    continue;
  }

  if (arg === "--python-bin") {
    explicitPythonBin = argv[i + 1] ?? "";
    i += 1;
    continue;
  }

  if (arg === "--") {
    passthroughArgs = argv.slice(i + 1);
    break;
  }

  passthroughArgs.push(arg);
}

if (!existsSync(integrationDir)) {
  fail(`Missing ${integrationDir}. Add an integration smoke test before using this runner.`);
}

const chosenPythonBin = explicitPythonBin || pythonBin;
const pytestArgs = [
  "-m",
  "pytest",
  "-p",
  "gltest_cli.config.plugin",
  integrationDir,
  "-v",
  "-s",
];

if (network) {
  pytestArgs.push("--network", network);
}

pytestArgs.push(...passthroughArgs);

const child = spawn(chosenPythonBin, pytestArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(
    `Failed to start ${chosenPythonBin}. Set PYTHON_BIN if your Python executable uses a different name.`
  );
  console.error(error.message);
  process.exit(1);
});
