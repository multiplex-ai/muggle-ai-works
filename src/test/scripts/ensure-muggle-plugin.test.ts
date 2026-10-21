import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const toBash = (p: string) => p.replace(/\\/g, "/");

const hookPath = toBash(fileURLToPath(new URL("../../../.claude/hooks/ensure-muggle-plugin.sh", import.meta.url)));
const projectSettingsPath = fileURLToPath(new URL("../../../.claude/settings.json", import.meta.url));

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the hook suites below skip
}

interface StubClaude {
  binDir: string;
  callsLog: string;
}

/** A `claude` stand-in that records every invocation and answers `plugin list` with `listOutput`. */
function makeStubClaude(listOutput: string, otherCommandsExitCode = 0): StubClaude {
  const binDir = mkdtempSync(join(tmpdir(), "muggle-claude-stub-"));
  const callsLog = join(binDir, "calls.log");
  writeFileSync(
    join(binDir, "claude"),
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> "${toBash(callsLog)}"`,
      'if [ "$1 $2" = "plugin list" ]; then',
      `  printf '%s\\n' "${listOutput}"`,
      "  exit 0",
      "fi",
      `exit ${otherCommandsExitCode}`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { binDir: binDir, callsLog: callsLog };
}

function runHook(pathValue: string): void {
  execFileSync("bash", [hookPath], { env: { ...process.env, PATH: pathValue }, stdio: "ignore" });
}

const recordedCalls = (stub: StubClaude): string[] =>
  existsSync(stub.callsLog) ? readFileSync(stub.callsLog, "utf-8").trim().split("\n") : [];

describe.skipIf(!hasBash)("ensure-muggle-plugin.sh", () => {
  it("leaves an installed plugin alone", () => {
    const stub = makeStubClaude("muggleai@muggle-works  5.22.0  user  enabled");

    runHook(`${stub.binDir}${delimiter}${process.env.PATH}`);

    expect(recordedCalls(stub)).toEqual(["plugin list"]);
  });

  it("installs a missing plugin at user scope, never into the committed project settings", () => {
    const stub = makeStubClaude("superpowers@claude-plugins-official  7.0.0  user  enabled");

    runHook(`${stub.binDir}${delimiter}${process.env.PATH}`);

    expect(recordedCalls(stub)).toEqual([
      "plugin list",
      "plugin marketplace add multiplex-ai/muggle-ai-works --scope user",
      "plugin install muggleai@muggle-works --scope user",
    ]);
  });

  it("never fails the session when the install commands fail", () => {
    const stub = makeStubClaude("", 1);

    expect(() => runHook(`${stub.binDir}${delimiter}${process.env.PATH}`)).not.toThrow();
    expect(recordedCalls(stub)).toHaveLength(3);
  });

  it("exits quietly when the claude CLI is not on PATH", () => {
    // PATH is emptied inside bash: the spawn itself resolves `bash` through the child's PATH on Windows.
    const runWithoutClaude = () =>
      execFileSync("bash", ["-c", 'PATH=/muggle-no-claude exec "$BASH" "$0"', hookPath], { stdio: "ignore" });

    expect(runWithoutClaude).not.toThrow();
  });
});

describe("project settings", () => {
  const projectSettings = JSON.parse(readFileSync(projectSettingsPath, "utf-8"));

  it("declares no marketplace source that a trusted checkout would re-register over the user's", () => {
    expect(projectSettings.extraKnownMarketplaces).toBeUndefined();
  });

  it("keeps the plugin enabled in the repo", () => {
    expect(projectSettings.enabledPlugins["muggleai@muggle-works"]).toBe(true);
  });
});
