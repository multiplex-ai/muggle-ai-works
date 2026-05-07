/**
 * CLI entrypoint: run the scenarios for one (gate, skill) pair N times,
 * aggregate per-scenario pass rates, write results.json next to the
 * scenarios.json in muggle-ai-brain/eval/skill-gate-eval/.
 *
 * Usage:
 *   tsx internal/skill-gate-eval/src/run.ts \
 *     --gate showElectronBrowser \
 *     --skill muggle-test-feature-local \
 *     --runs 10 \
 *     [--brain-dir ../muggle-ai-brain] \
 *     [--model claude-sonnet-4-6]
 *
 * Pass threshold: 99% (per design doc).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { loadScenarioFile } from "./scenario.js";
import { runScenarioOnce, RunVerdict } from "./harness.js";

const PASS_THRESHOLD = 0.99;
const DEFAULT_MODEL = "claude-sonnet-4-6";

interface CliArgs {
  gate: string;
  skill: string;
  runs: number;
  brainDir: string;
  skillsDir: string;
  model: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      out[key] = val;
      i++;
    }
  }
  if (!out.gate || !out.skill) {
    throw new Error("Required: --gate <key> --skill <name>");
  }
  return {
    gate: out.gate,
    skill: out.skill,
    runs: parseInt(out.runs ?? "10", 10),
    brainDir: out["brain-dir"] ?? process.env.MUGGLE_BRAIN_DIR ?? "../muggle-ai-brain",
    skillsDir: out["skills-dir"] ?? "plugin/skills",
    model: out.model ?? DEFAULT_MODEL,
  };
}

interface ScenarioReport {
  name: string;
  runs: number;
  passes: number;
  passRate: number;
  passed: boolean;
  failureReasons: string[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarioFilePath = path.resolve(
    args.brainDir,
    "eval",
    "skill-gate-eval",
    args.gate,
    "scenarios.json",
  );
  if (!fs.existsSync(scenarioFilePath)) {
    throw new Error(`No scenario file at ${scenarioFilePath}`);
  }
  const scenarioFile = loadScenarioFile(scenarioFilePath);
  if (scenarioFile.skill !== args.skill) {
    throw new Error(
      `Scenario file is for skill ${scenarioFile.skill}, not ${args.skill}`,
    );
  }

  const reports: ScenarioReport[] = [];
  for (const scenario of scenarioFile.scenarios) {
    const verdicts: RunVerdict[] = [];
    for (let i = 0; i < args.runs; i++) {
      // eslint-disable-next-line no-await-in-loop
      verdicts.push(
        await runScenarioOnce({
          scenarioFile,
          scenarioFilePath,
          scenario,
          skillsDir: path.resolve(args.skillsDir),
          model: args.model,
        }),
      );
    }
    const passes = verdicts.filter((v) => v.pass).length;
    const passRate = passes / verdicts.length;
    const failureReasons = Array.from(
      new Set(verdicts.flatMap((v) => v.reasons)),
    );
    reports.push({
      name: scenario.name,
      runs: verdicts.length,
      passes,
      passRate,
      passed: passRate >= PASS_THRESHOLD,
      failureReasons,
    });
  }

  const resultsPath = path.resolve(
    path.dirname(scenarioFilePath),
    "results.json",
  );
  fs.writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        gate: args.gate,
        skill: args.skill,
        model: args.model,
        runsPerScenario: args.runs,
        passThreshold: PASS_THRESHOLD,
        recordedAt: new Date().toISOString(),
        scenarios: reports,
      },
      null,
      2,
    ),
  );

  const allPassed = reports.every((r) => r.passed);
  // eslint-disable-next-line no-console
  console.log(
    `[skill-gate-eval] ${args.gate} on ${args.skill}: ${reports.filter((r) => r.passed).length}/${reports.length} scenarios passed @ ≥${(PASS_THRESHOLD * 100).toFixed(0)}%`,
  );
  for (const r of reports) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${r.passed ? "PASS" : "FAIL"}  ${r.name}  (${r.passes}/${r.runs} = ${(r.passRate * 100).toFixed(1)}%)`,
    );
    for (const reason of r.failureReasons) {
      // eslint-disable-next-line no-console
      console.log(`    - ${reason}`);
    }
  }
  process.exit(allPassed ? 0 : 1);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(2);
});
