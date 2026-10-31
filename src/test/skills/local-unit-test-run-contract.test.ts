/**
 * Pins how shipped instructions run a test suite locally. Repos key their local worker cap and
 * changed-files scoping on `CI` being unset, so an instruction to set it for a local run runs the
 * full suite at one worker per core on a shared dev machine.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const UNIT_TESTS_STAGE = path.join(PLUGIN_DIR, "skills", "do", "unit-tests.md");

const CI_ASSIGNMENT = /\bCI=(?:true|1)\b/;
const CI_PROHIBITION = "Never set `CI=true`";

describe("local unit-test runs", () => {
  it("no shipped instruction tells the agent to set CI", () => {
    const pluginMarkdown = readdirSync(PLUGIN_DIR, { recursive: true, encoding: "utf-8" })
      .filter((relativePath) => relativePath.endsWith(".md"))
      .map((relativePath) => path.join(PLUGIN_DIR, relativePath));
    const ciAssignments = pluginMarkdown.flatMap((markdownPath) =>
      readFileSync(markdownPath, "utf8")
        .split("\n")
        .filter((line) => CI_ASSIGNMENT.test(line.replaceAll(CI_PROHIBITION, "")))
        .map((line) => `${path.relative(REPO_ROOT, markdownPath)}: ${line.trim()}`),
    );

    expect(ciAssignments).toEqual([]);
  });

  it("the unit-test stage gets one-shot mode from the runner and launches through the cap", () => {
    const stage = readFileSync(UNIT_TESTS_STAGE, "utf8");

    expect(stage).toContain("`vitest run`");
    expect(stage).toContain("`--watchAll=false`");
    expect(stage).toContain(CI_PROHIBITION);
    expect(stage).toContain("scripts/guard-run.mjs");
  });
});
