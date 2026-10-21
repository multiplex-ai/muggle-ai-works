import { describe, it, expect } from "vitest";
import { readdirSync } from "fs";
import { join, relative } from "path";
import { HOOK_RUNTIME_SOURCE_ENTRIES, PLUGIN_SCRIPTS_DIR, REPO_ROOT } from "./support/constants.js";
import { findUnhiddenSpawnCalls, findUnhiddenSpawnCallsInFiles, reachableSourceFiles } from "./support/spawnScan.js";

// A hook started without a console of its own — Codex on Windows fires them that
// way — hands every child it starts a fresh console, and Windows paints each one
// as a window: a `gh` lookup per tool call becomes a stream of popups. Nothing ties
// a newly added spawn to windowsHide, so these hold the shipped scripts, and the
// sources tsup bundles into them, to it.
const shippedScripts = readdirSync(PLUGIN_SCRIPTS_DIR)
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => join(PLUGIN_SCRIPTS_DIR, name));
const bundledSources = reachableSourceFiles(HOOK_RUNTIME_SOURCE_ENTRIES);

describe("hook runtime child processes", () => {
  it("all pass windowsHide, so none opens a console window on Windows", () => {
    expect(findUnhiddenSpawnCallsInFiles([...shippedScripts, ...bundledSources])).toEqual([]);
  });

  it("are found through the bundles' import graph, not just the entry files", () => {
    const repoRelativeSources = bundledSources.map((filePath) => relative(REPO_ROOT, filePath).replaceAll("\\", "/"));
    expect(repoRelativeSources).toEqual(
      expect.arrayContaining(["src/guardrails/walkthroughOwed.ts", "src/pr-walkthrough/gh.ts", "src/e2e-skip/probes.ts"]),
    );
  });
});

describe("findUnhiddenSpawnCalls", () => {
  it("flags every call without an inline windowsHide: true, under each import form", () => {
    const fixtureSource = [
      'import { execFileSync, spawn as launch } from "node:child_process";',
      'import * as childProcess from "child_process";',
      'execFileSync("gh", ["pr", "view"], { encoding: "utf-8", windowsHide: true });',
      'execFileSync("git", ["status"], { encoding: "utf-8" });',
      'launch("node", [], { windowsHide: false });',
      'childProcess.spawnSync("where", ["git"], sharedOptions);',
      'childProcess.exec("ls", { windowsHide: true });',
    ].join("\n");

    expect(findUnhiddenSpawnCalls("fixture.ts", fixtureSource)).toEqual([
      { file: "fixture.ts", line: 4, callee: "execFileSync" },
      { file: "fixture.ts", line: 5, callee: "launch" },
      { file: "fixture.ts", line: 6, callee: "childProcess.spawnSync" },
    ]);
  });
});
