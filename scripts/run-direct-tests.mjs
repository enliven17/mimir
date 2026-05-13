#!/usr/bin/env node

import { spawn } from "node:child_process";

const pythonBin = process.env.PYTHON_BIN || "python";
const pytestArgs = process.argv.slice(2);

const args = [
  "-m",
  "pytest",
  "-p",
  "gltest.direct.pytest_plugin",
  "tests/direct",
  "-v",
  ...pytestArgs,
];

const child = spawn(pythonBin, args, {
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
    `Failed to start ${pythonBin}. Set PYTHON_BIN if your Python executable uses a different name.`,
  );
  console.error(error.message);
  process.exit(1);
});
