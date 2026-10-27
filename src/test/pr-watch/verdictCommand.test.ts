import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { USAGE_EXIT_CODE } from "../../pr-watch/constants.js";
import { parseVerdictArguments, runPrWatchVerdictCommand } from "../../pr-watch/verdictCommand.js";
import { WatchTickVerdict, type WatchPreferences } from "../../pr-watch/types.js";

const SHIPPED_BUNDLE = fileURLToPath(new URL("../../../plugin/scripts/pr-watch-verdict.mjs", import.meta.url));
const TICK_CONTRACT = fileURLToPath(new URL("../../../plugin/skills/muggle-pr-followup/contract.md", import.meta.url));

const preferences = (): WatchPreferences => ({ autoRebase: "always", maxCatchUpRebases: 20 });
const lastSeen = (entry: object): string => JSON.stringify({ "o/r#7": entry });
const tickArgs = (rebaseDue: string, ci: string): string[] => [
  "tick",
  "--pr-key",
  "o/r#7",
  "--head",
  "h1",
  "--rebase-key",
  "h1..b1",
  "--rebase-due",
  rebaseDue,
  "--ci",
  ci,
];

describe("parseVerdictArguments", () => {
  it("pairs each flag with its value and reads a bare flag as empty", () => {
    expect(parseVerdictArguments(["--pr-key", "o/r#7", "--head", "--ci", "red"])).toEqual({
      "pr-key": "o/r#7",
      head: "",
      ci: "red",
    });
  });
});

describe("runPrWatchVerdictCommand", () => {
  it("arm-floors reports the attempts recorded for this key and head", () => {
    const outcome = runPrWatchVerdictCommand(
      ["arm-floors", "--pr-key", "o/r#7", "--head", "h1", "--rebase-key", "h1..b1"],
      lastSeen({ conflict_resolve_attempts: { "h1..b1": 1 }, conflict_escalated_keys: ["h1..b1"], ci_escalated_shas: ["h1"] }),
      preferences,
    );
    expect(outcome).toEqual({
      stdout: "REBASE_ATTEMPTED=1\nCI_ATTEMPTED=0\nBLOCKED_CIDIGEST=\nREBASE_BUDGET_EXHAUSTED=0\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("arm-floors reports a spent catch-up rebase budget against the resolved cap", () => {
    const armFloors = ["arm-floors", "--pr-key", "o/r#7", "--head", "h1", "--rebase-key", "h1..b1"];
    const spent = lastSeen({ catch_up_rebases: 20 });
    expect(runPrWatchVerdictCommand(armFloors, spent, preferences).stdout).toContain("REBASE_BUDGET_EXHAUSTED=1\n");
    expect(
      runPrWatchVerdictCommand(armFloors, spent, () => ({ autoRebase: "always", maxCatchUpRebases: 25 })).stdout,
    ).toContain("REBASE_BUDGET_EXHAUSTED=0\n");
  });

  it("tick prints the verdict", () => {
    expect(runPrWatchVerdictCommand(tickArgs("yes", "green"), lastSeen({}), preferences).stdout).toBe(
      `VERDICT=${WatchTickVerdict.DispatchRebase}\n`,
    );
    expect(runPrWatchVerdictCommand(tickArgs("no", "red"), "", preferences).stdout).toBe(
      `VERDICT=${WatchTickVerdict.DispatchFixCi}\n`,
    );
  });

  it("refuses a malformed invocation rather than guessing a verdict", () => {
    for (const commandLine of [
      ["tick", "--head", "h1"],
      tickArgs("yes", "purple"),
      ["tick", "--pr-key", "o/r#7", "--ci", "red"],
      ["unknown", "--pr-key", "o/r#7"],
    ]) {
      const outcome = runPrWatchVerdictCommand(commandLine, "", preferences);
      expect(outcome.exitCode).toBe(USAGE_EXIT_CODE);
      expect(outcome.stdout).toBe("");
      expect(outcome.stderr).toContain("usage:");
    }
  });
});

// The arm script and the tick run the committed bundle, not the source.
describe("the shipped pr-watch-verdict.mjs", () => {
  it("reads last_seen.json from stdin and prints the verdict", () => {
    const run = spawnSync(process.execPath, [SHIPPED_BUNDLE, ...tickArgs("yes", "green")], {
      input: lastSeen({ conflict_escalated_keys: ["h1..b1"] }),
      encoding: "utf-8",
      windowsHide: true,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`VERDICT=${WatchTickVerdict.DispatchRebase}\n`);
  });

  it("treats empty stdin as nothing recorded", () => {
    const run = spawnSync(
      process.execPath,
      [SHIPPED_BUNDLE, "arm-floors", "--pr-key", "o/r#7", "--head", "h1", "--rebase-key", "h1..b1"],
      { input: "", encoding: "utf-8", windowsHide: true },
    );
    expect(run.stdout).toBe("REBASE_ATTEMPTED=0\nCI_ATTEMPTED=0\nBLOCKED_CIDIGEST=\nREBASE_BUDGET_EXHAUSTED=0\n");
  });
});

// The tick is prose a model follows; every verdict the script can print needs a
// branch there, or the model improvises one.
describe("contract.md follows the verdict script", () => {
  const contract = readFileSync(TICK_CONTRACT, "utf-8");

  it("runs the script for Steps 5-7", () => {
    expect(contract).toContain("pr-watch-verdict.mjs");
    expect(contract).toMatch(/pr-watch-verdict\.mjs"? tick/);
  });

  it.each(Object.values(WatchTickVerdict))("names what to do on %s", (verdict) => {
    expect(contract).toContain(`\`${verdict}\``);
  });
});
