/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins fix-ci's per-head budget. A cycle dispatched after the head already spent
 * its three attempts must escalate without fixing — a fixable failure once
 * tempted the cycle to push anyway. These assertions do NOT catch an agent that
 * reads the rule and ignores it; the muggle-do.modes `fix-ci-budget` scenario does.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_CI = fs.readFileSync(path.resolve(__dirname, "../../../plugin/skills/do/fix-ci.md"), "utf8");

const reattachStep = sectionBody(FIX_CI, /^### Step 1 — Re-attach.*$/m);
const escalateStep = sectionBody(FIX_CI, /^### Step 6 — Escalate.*$/m);

describe("fix-ci budget", () => {
  it("stops a cycle whose head spent its budget before it began", () => {
    expect(reattachStep).toMatch(/past 3/);
    expect(reattachStep).toMatch(/no fix, no re-run and no push/);
    expect(reattachStep).toMatch(/Step 6/);
  });

  it("escalates a spent budget whether or not a fix could be pushed", () => {
    expect(escalateStep).toMatch(/Step 1 found the budget already spent/);
  });
});
