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
 *     [--model claude-sonnet-4-6] \
 *     [--scenario <substring>]   # only run scenarios whose name contains this
 *     [--verbose]                 # dump per-run trace to stderr
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { DEFAULT_MODEL, MODEL_ALIASES, PASS_THRESHOLD } from "./constants.js";
import { runScenarioOnce } from "./harness.js";
import { loadScenarioFile } from "./scenario.js";
import type { CliArgs, RunVerdict, ScenarioReport } from "./types.js";

interface RunCliArgs extends CliArgs {
  scenarioFilter?: string;
  verbose: boolean;
}

/** Resolve a `/model`-style value (alias or full id) to a model id; `inherit`/empty falls back. */
function resolveModel(raw: string | undefined, fallback: string): string {
  if (!raw || raw === "inherit") return fallback;
  return MODEL_ALIASES[raw] ?? raw;
}

/**
 * Read a skill's `model:` frontmatter so the eval runs it on the same model
 * production would. Returns undefined when the skill leaves `model:` unset
 * (it inherits the session model — represented here by DEFAULT_MODEL).
 */
function frontmatterModel(skillsDir: string, skill: string): string | undefined {
  const p = path.resolve(skillsDir, skill, "SKILL.md");
  if (!fs.existsSync(p)) return undefined;
  const body = fs.readFileSync(p, "utf8");
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const m = fm[1].match(/^model:[ \t]*(.+?)[ \t]*$/m);
  return m ? m[1].trim() : undefined;
}

function parseArgs(argv: string[]): RunCliArgs {
  const out: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      flags.add(key);
    } else {
      out[key] = val;
      i++;
    }
  }
  if (!out.gate || !out.skill) {
    throw new Error("Required: --gate <key> --skill <name>");
  }
  const skillsDir = out["skills-dir"] ?? "plugin/skills";
  // Precedence: explicit --model > the skill's declared `model:` > DEFAULT_MODEL.
  // Honoring the frontmatter means the eval exercises the skill on the same
  // model it runs on in production (e.g. a haiku-tier skill is tested on haiku).
  const model = out.model
    ? resolveModel(out.model, DEFAULT_MODEL)
    : resolveModel(frontmatterModel(skillsDir, out.skill), DEFAULT_MODEL);
  return {
    gate: out.gate,
    skill: out.skill,
    runs: parseInt(out.runs ?? "10", 10),
    brainDir: out["brain-dir"] ?? process.env.MUGGLE_BRAIN_DIR ?? "../muggle-ai-brain",
    skillsDir: skillsDir,
    model: model,
    scenarioFilter: out.scenario,
    verbose: flags.has("verbose"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line no-console
  console.error(`[skill-gate-eval] ${args.gate} on ${args.skill} — model=${args.model} runs=${args.runs}`);
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

  const filteredScenarios = args.scenarioFilter
    ? scenarioFile.scenarios.filter((s) => s.name.includes(args.scenarioFilter!))
    : scenarioFile.scenarios;
  if (filteredScenarios.length === 0) {
    throw new Error(
      `No scenarios match --scenario "${args.scenarioFilter}" — available: ${scenarioFile.scenarios.map((s) => s.name).join(", ")}`,
    );
  }

  const reports: ScenarioReport[] = [];
  for (const scenario of filteredScenarios) {
    const verdicts: RunVerdict[] = [];
    for (let i = 0; i < args.runs; i++) {
      // eslint-disable-next-line no-console
      console.error(`[skill-gate-eval] running ${scenario.name} (rep ${i + 1}/${args.runs})…`);
      // eslint-disable-next-line no-await-in-loop
      const v = await runScenarioOnce(
        {
          scenarioFile: scenarioFile,
          scenarioFilePath: scenarioFilePath,
          scenario: scenario,
          skillsDir: path.resolve(args.skillsDir),
          model: args.model,
        },
        args.verbose ? (msg) => process.stderr.write(`[sdk] ${oneLine(msg)}\n`) : undefined,
      );
      verdicts.push(v);
      if (args.verbose) {
        // eslint-disable-next-line no-console
        console.error(JSON.stringify(v, null, 2));
      }
    }
    const passes = verdicts.filter((v) => v.pass).length;
    const passRate = passes / verdicts.length;
    const failureReasons = Array.from(
      new Set(verdicts.flatMap((v) => v.reasons)),
    );
    reports.push({
      name: scenario.name,
      runs: verdicts.length,
      passes: passes,
      passRate: passRate,
      passed: passRate >= PASS_THRESHOLD,
      failureReasons: failureReasons,
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

function oneLine(msg: unknown): string {
  const s = JSON.stringify(msg);
  return s.length > 500 ? s.slice(0, 500) + "…" : s;
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(2);
});
