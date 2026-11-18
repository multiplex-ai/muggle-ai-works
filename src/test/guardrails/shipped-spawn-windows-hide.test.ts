import { describe, it, expect } from "vitest";
import { relative } from "path";
import { ALLOWED_UNHIDDEN_SPAWNS, REPO_ROOT } from "./support/constants.js";
import { shippedSourceFiles } from "./support/shippedSources.js";
import { findUnhiddenSpawnCalls, findUnhiddenSpawnCallsInFiles } from "./support/spawnScan.js";

// A process with no console of its own — a hook Codex fires on Windows, a detached job, a scheduled task — hands
// every console child it starts a fresh console, and Windows paints each one as a window that steals focus from
// whatever the user is typing into. Nothing ties a newly added spawn to windowsHide, so these hold every file the
// package ships to it: the MCP server, the CLI, install scripts and hook bundles alike.
const shippedFiles = shippedSourceFiles();
const isAllowed = (call: { file: string; callee: string }): boolean =>
  ALLOWED_UNHIDDEN_SPAWNS.some((allowed) => allowed.file === call.file && allowed.callee === call.callee);

describe("shipped child processes", () => {
  it("all pass windowsHide, so none opens a console window on Windows", () => {
    expect(findUnhiddenSpawnCallsInFiles(shippedFiles).filter((call) => !isAllowed(call))).toEqual([]);
  });

  it("are scanned across the MCP server, the CLI, install scripts and the hook bundles", () => {
    const repoRelativeFiles = shippedFiles.map((filePath) => relative(REPO_ROOT, filePath).replaceAll("\\", "/"));
    expect(repoRelativeFiles).toEqual(
      expect.arrayContaining([
        "packages/mcps/src/shared/open-browser.ts",
        "src/cli/setup.ts",
        "scripts/postinstall.mjs",
        "plugin/scripts/guardrails.mjs",
        "bin/muggle.js",
      ]),
    );
    expect(repoRelativeFiles.some((file) => file.includes("/test/") || /\.test\.[cm]?[jt]s$/.test(file))).toBe(false);
  });

  it("are exempt only where an allowance still names a real unhidden call", () => {
    const unhiddenCalls = findUnhiddenSpawnCallsInFiles(shippedFiles);
    const staleAllowances = ALLOWED_UNHIDDEN_SPAWNS.filter(
      (allowed) => !unhiddenCalls.some((call) => call.file === allowed.file && call.callee === allowed.callee),
    );
    expect(staleAllowances).toEqual([]);
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

  it("follows require in both forms and promisify wrappers to their callers", () => {
    const fixtureSource = [
      'const childProcess = require("child_process");',
      'const { execFile: runFile } = require("node:child_process");',
      'const util = require("util");',
      "const execAsync = util.promisify(childProcess.exec);",
      "const runFileAsync = promisify(runFile);",
      'childProcess.exec("REG.exe QUERY");',
      'runFile("tar", ["-xzf", archive], { windowsHide: true });',
      'execAsync("REG.exe QUERY");',
      'runFileAsync("unzip", [archive], { windowsHide: true });',
    ].join("\n");

    expect(findUnhiddenSpawnCalls("fixture.cjs", fixtureSource)).toEqual([
      { file: "fixture.cjs", line: 6, callee: "childProcess.exec" },
      { file: "fixture.cjs", line: 8, callee: "execAsync" },
    ]);
  });
});
