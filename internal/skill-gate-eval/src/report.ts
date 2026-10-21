/**
 * Emit a markdown summary of the skill-gate-eval results.json files so CI can
 * drop it into the job summary and a PR comment. Reads every
 * `<gate>/results.json` under `<brain-dir>/eval/skill-gate-eval/` — or, with
 * `--host codex`, every `<gate>/results.codex.json`.
 *
 * Usage: tsx internal/skill-gate-eval/src/report.ts [brain-dir] [--host codex]
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { RESULTS_FILENAME_BY_HOST } from "./constants.js";
import { EvalHost } from "./types.js";
import type { ScenarioReport } from "./types.js";

interface GateResult {
  gate: string;
  skill: string;
  model: string;
  runsPerScenario: number;
  scenarios: ScenarioReport[];
}

const cliArgs = process.argv.slice(2);
const hostFlag = cliArgs.indexOf("--host");
const host = (hostFlag >= 0 ? cliArgs[hostFlag + 1] : EvalHost.Claude) as EvalHost;
const resultsFilename = RESULTS_FILENAME_BY_HOST[host];
if (!resultsFilename) throw new Error(`--host must be one of ${Object.values(EvalHost).join(", ")}`);
const hostValueIndex = hostFlag >= 0 ? hostFlag + 1 : -1;
const brainDirArg = cliArgs.find((arg, index) => !arg.startsWith("--") && index !== hostValueIndex);
const brainDir = brainDirArg ?? process.env.MUGGLE_BRAIN_DIR ?? "../muggle-ai-brain";
const gateDir = path.resolve(brainDir, "eval", "skill-gate-eval");
const title = host === EvalHost.Codex ? "### 🚪 Skill gate eval — Codex" : "### 🚪 Skill gate eval";

const files = fs.existsSync(gateDir)
  ? fs
      .readdirSync(gateDir)
      .map((d) => path.join(gateDir, d, resultsFilename))
      .filter((f) => fs.existsSync(f))
      .sort()
  : [];

if (files.length === 0) {
  process.stdout.write(`${title}\n\n_No ${resultsFilename} found._\n`);
  process.exit(0);
}

const rows: string[] = [
  title,
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
