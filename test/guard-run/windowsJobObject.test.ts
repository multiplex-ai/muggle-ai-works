import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Runs the shipped bundle against the real Job Object, so it only means anything on Windows.
const GUARD_RUN_PATH = join(__dirname, "..", "..", "plugin", "scripts", "guard-run.mjs");
const POWERSHELL_STARTUP_ALLOWANCE_MS = 60_000;

// Starts N sleeping children at once and reports how many the OS let through. A job refusal surfaces as a
// synchronous "spawn UNKNOWN" throw, not an "error" event.
const SPAWN_PROBE_SOURCE = `
const { spawn } = require("node:child_process");
const attempts = Number(process.argv[2]);
const children = [];
let started = 0;
let refused = 0;
const settle = () => {
  if (started + refused < attempts) return;
  console.log(JSON.stringify({ started: started, refused: refused }));
  for (const child of children) child.kill();
};
for (let attempt = 0; attempt < attempts; attempt++) {
  try {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]);
    children.push(child);
    child.on("spawn", () => { started++; settle(); });
    child.on("error", () => { refused++; settle(); });
  } catch {
    refused++;
    settle();
  }
}
`;

const scratchDir = mkdtempSync(join(tmpdir(), "guard-run-win-"));

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function runGuardRun(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [GUARD_RUN_PATH, ...args], {
    encoding: "utf-8",
    env: env,
    timeout: POWERSHELL_STARTUP_ALLOWANCE_MS,
    windowsHide: true,
  });
}

describe.skipIf(process.platform !== "win32")("guard-run Windows Job Object", () => {
  it(
    "refuses spawns past the limit and says the cap did it",
    () => {
      const probePath = join(scratchDir, "spawn-probe.js");
      writeFileSync(probePath, SPAWN_PROBE_SOURCE);

      const result = runGuardRun(["--limit", "4", "--", "node", probePath, "8"]);

      const { started, refused } = JSON.parse(result.stdout.trim()) as { started: number; refused: number };
      // The probe itself is the first of the four.
      expect(started).toBeLessThanOrEqual(3);
      expect(started + refused).toBe(8);
      expect(result.stderr).toContain("active-process limit of 4");
    },
    POWERSHELL_STARTUP_ALLOWANCE_MS,
  );

  it(
    "launches an npm-style .cmd shim whose extensionless POSIX twin where.exe lists first",
    () => {
      const shimDir = mkdtempSync(join(scratchDir, "shim-"));
      writeFileSync(join(shimDir, "greet"), "#!/bin/sh\necho posix-shim\n");
      writeFileSync(join(shimDir, "greet.cmd"), "@echo greet-ok\r\n");
      const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";

      const result = runGuardRun(["--", "greet"], {
        ...process.env,
        [pathKey]: `${shimDir}${delimiter}${process.env[pathKey] ?? ""}`,
      });

      expect(result.stderr).not.toContain("CreateProcess");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("greet-ok");
    },
    POWERSHELL_STARTUP_ALLOWANCE_MS,
  );
});
