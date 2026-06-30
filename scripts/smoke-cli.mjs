#!/usr/bin/env node

// Real-subprocess smoke of the shipped CLI. Runs the published entry
// (bin/muggle.js -> dist/cli.js) the way a user does — argv in, stdout/exit
// out — so a break in the bin shim, the commander wiring, or the bundled boot
// path surfaces here. The handler logic is unit-tested from source; this pins
// the end-to-end contract the "Lazy core" footprint refactor (which pins the
// launch and lazy-loads the server) must preserve. Runs after `pnpm run build`.

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin", "muggle.js");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version;

// Every command createProgram() registers (run-cli.ts). The --help check below
// is the surface oracle: a boot regression that drops one fails here.
const expectedCommands = [
  "serve",
  "setup",
  "upgrade",
  "versions",
  "cleanup",
  "doctor",
  "login",
  "logout",
  "status",
  "build-pr-section",
];

// https-only report: collectGsUrls() finds nothing, so build-pr-section renders
// offline with no prompt-service call or credential lookup — deterministic in CI.
const sampleReport = JSON.stringify({
  projectId: "p1",
  tests: [
    {
      name: "A",
      testCaseId: "a",
      runId: "ra",
      viewUrl: "https://example.com/a",
      status: "passed",
      steps: [{ stepIndex: 0, action: "Click", screenshotUrl: "https://cdn/a0.png" }],
    },
  ],
});

const failures = [];

function run(args, input) {
  return spawnSync(process.execPath, [bin, ...args], { input, encoding: "utf-8", timeout: 30_000 });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function check(name, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`${name} — ${error.message}`);
  }
}

check("muggle --version prints the package version", () => {
  const result = run(["--version"]);
  assert(result.status === 0, `exited ${result.status}`);
  assert(result.stdout.trim() === version, `printed '${result.stdout.trim()}', expected '${version}'`);
});

check("muggle --help advertises every registered command", () => {
  const result = run(["--help"]);
  assert(result.status === 0, `exited ${result.status}`);
  for (const command of expectedCommands) {
    assert(result.stdout.includes(command), `--help omits '${command}'`);
  }
});

check("muggle help prints the how-to guide", () => {
  const result = run(["help"]);
  assert(result.status === 0, `exited ${result.status}`);
  assert(result.stdout.includes("Muggle AI Works"), "guide text missing");
});

check("muggle build-pr-section renders the PR evidence block from stdin", () => {
  const result = run(["build-pr-section"], sampleReport);
  assert(result.status === 0, `exited ${result.status}: ${result.stderr}`);
  const body = JSON.parse(result.stdout).body;
  assert(body.startsWith("<!-- muggle-pr-section:v1 -->\n"), "missing section marker");
  assert(body.includes("E2E Acceptance Results"), "missing results heading");
});

check("muggle rejects an unknown command with a nonzero exit (never hangs)", () => {
  const result = run(["definitely-not-a-command"]);
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
});

if (failures.length > 0) {
  console.error("CLI smoke failed:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`CLI smoke passed (${expectedCommands.length} commands, ${bin}).`);
