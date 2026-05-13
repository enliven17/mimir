#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const SCRIPT_NAME = process.platform === "win32" ? "genvm-lint.exe" : "genvm-lint";

function renderCommand(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    shell: options.shell ?? false,
    env: {
      ...process.env,
      PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
      PYTHONUTF8: process.env.PYTHONUTF8 || "1",
      ...(options.env || {}),
    },
  });
}

function getPythonCandidates() {
  const candidates = [];

  if (process.env.PYTHON_BIN) {
    candidates.push(process.env.PYTHON_BIN);
  }

  if (process.platform === "win32") {
    candidates.push("python", "py");
  } else {
    candidates.push("python3", "python");
  }

  return [...new Set(candidates.filter(Boolean))];
}

function pickWorkingPython() {
  for (const candidate of getPythonCandidates()) {
    const result = run(candidate, ["--version"]);
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function getUserScriptCandidate(pythonBin) {
  const probe = run(pythonBin, [
    "-c",
    [
      "import os, site, pathlib",
      "usersite = pathlib.Path(site.getusersitepackages())",
      process.platform === "win32"
        ? `print(usersite.parent / "Scripts" / "${SCRIPT_NAME}")`
        : `print(pathlib.Path(site.getuserbase()) / "bin" / "${SCRIPT_NAME}")`,
    ].join("; "),
  ]);

  if (probe.error || probe.status !== 0) {
    return null;
  }

  const discoveredPath = probe.stdout.trim();
  if (!discoveredPath) {
    return null;
  }

  return discoveredPath;
}

function getCandidateCommands() {
  const candidates = [];

  if (process.env.GENVM_LINT_BIN) {
    candidates.push(process.env.GENVM_LINT_BIN);
  }

  const venvCandidate = path.resolve(
    process.cwd(),
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    SCRIPT_NAME
  );
  if (existsSync(venvCandidate)) {
    candidates.push(venvCandidate);
  }

  candidates.push("genvm-lint");

  const pythonBin = pickWorkingPython();
  if (pythonBin) {
    const userScriptCandidate = getUserScriptCandidate(pythonBin);
    if (userScriptCandidate && existsSync(userScriptCandidate)) {
      candidates.push(userScriptCandidate);
    }
  }

  return [...new Set(candidates)];
}

function pickGenvmLintCommand() {
  const failures = [];

  for (const candidate of getCandidateCommands()) {
    const result = run(candidate, ["--help"]);
    if (!result.error && result.status === 0) {
      return candidate;
    }

    failures.push(
      [candidate, result.stderr?.trim(), result.stdout?.trim()]
        .filter(Boolean)
        .join("\n")
    );
  }

  console.error("ERROR: Could not locate a working genvm-lint executable.");
  console.error("Tried:");
  for (const failure of failures) {
    console.error(`- ${failure}\n`);
  }
  console.error(
    "Install `genvm-linter`, add its Scripts directory to PATH, or set GENVM_LINT_BIN to the executable path."
  );
  process.exit(1);
}

const lintCommand = pickGenvmLintCommand();
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Usage: node scripts/run-genvm-lint.mjs <genvm-lint args...>");
  process.exit(0);
}

const result = spawnSync(lintCommand, args, {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
    PYTHONUTF8: process.env.PYTHONUTF8 || "1",
  },
});

if (result.error) {
  console.error(`ERROR: Failed to start ${renderCommand(lintCommand, args)}`);
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
