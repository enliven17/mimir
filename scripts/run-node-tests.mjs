#!/usr/bin/env node
/**
 * Runs every tests/node/*.test.ts file under node:test.
 *
 * Discovery instead of a hand-maintained list: the previous hardcoded list in
 * package.json silently dropped three suites as they were added.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "tests", "node");

const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.join("tests", "node", f));

if (files.length === 0) {
  console.error("No test files found in tests/node");
  process.exit(1);
}

console.log(`Running ${files.length} test files`);
const res = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { cwd: root, stdio: "inherit" },
);
process.exit(res.status ?? 1);
