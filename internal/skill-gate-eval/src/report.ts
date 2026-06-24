/**
 * Emit a markdown summary of the skill-gate-eval results.json files so CI can
 * drop it into the job summary and a PR comment. Reads every
 * `<gate>/results.json` under `<brain-dir>/eval/skill-gate-eval/`.
 *
 * Usage: tsx internal/skill-gate-eval/src/report.ts [brain-dir]
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ScenarioReport } from "./types.js";

interface GateResult {
  gate: string;
  skill: string;
  model: string;
  runsPerScenario: number;
  scenarios: ScenarioReport[];
}

const brainDir = process.argv[2] ?? process.env.MUGGLE_BRAIN_DIR ?? "../muggle-ai-brain";
const gateDir = path.resolve(brainDir, "eval", "skill-gate-eval");

const files = fs.existsSync(gateDir)
  ? fs
      .readdirSync(gateDir)
      .map((d) => path.join(gateDir, d, "results.json"))
      .filter((f) => fs.existsSync(f))
      .sort()
  : [];

if (files.length === 0) {
  process.stdout.write("### 🚪 Skill gate eval\n\n_No results.json found._\n");
  process.exit(0);
}

const rows: string[] = [
  "### 🚪 Skill gate eval",
  "",
  "| Gate | Skill | Model | Scenarios | Status |",
  "| :--- | :--- | :--- | :---: | :---: |",
];
const details: string[] = [];

for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, "utf8")) as GateResult;
  const passed = r.scenarios.filter((s) => s.passed).length;
  const ok = r.scenarios.length > 0 && r.scenarios.every((s) => s.passed);
  rows.push(
    `| \`${r.gate}\` | \`${r.skill}\` | \`${r.model}\` | ${passed}/${r.scenarios.length} | ${ok ? "✅" : "❌"} |`,
  );
  for (const s of r.scenarios) {
    const reasons = s.passed ? "" : ` — ${s.failureReasons.join("; ")}`;
    details.push(
      `- ${s.passed ? "✓" : "✗"} \`${r.gate}\`/${s.name}: ${s.passes}/${s.runs} (${(s.passRate * 100).toFixed(0)}%)${reasons}`,
    );
  }
}

const out = [
  ...rows,
  "",
  "<details><summary>Per-scenario detail</summary>",
  "",
  ...details,
  "</details>",
  "",
].join("\n");

process.stdout.write(out + "\n");
