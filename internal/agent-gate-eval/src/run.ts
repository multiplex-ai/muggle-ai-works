/**
 * CLI entrypoint: run one agent's behavioral scenarios N times each,
 * aggregate per-scenario pass rates, write results.json next to the
 * scenario file.
 *
 * Usage:
 *   tsx internal/agent-gate-eval/src/run.ts \
 *     --agent test-prepare-runner \
 *     [--runs 5] \
 *     [--agents-dir plugin/agents] \
 *     [--scenarios-dir internal/agent-gate-eval/scenarios] \
 *     [--concurrency 8]           # parallel reps; AGENT_GATE_EVAL_CONCURRENCY env also works
 *     [--scenario <substring>]    # only run scenarios whose name contains this
 *     [--verbose]                 # dump per-run trace to stderr
 *
 * The model is always the agent's frontmatter pin — there is no --model
 * override: the pinned model honoring the contract IS what this eval gates.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  runWithConcurrencyLimit,
  ThrottleGate,
  withThrottleRetry,
} from "../../skill-gate-eval/src/concurrency.js";
import {
  DEFAULT_GATE_EVAL_CONCURRENCY,
  PASS_THRESHOLD,
} from "../../skill-gate-eval/src/constants.js";
import { loadAgentDefinition } from "./agent-definition.js";
import { runAgentScenarioOnce } from "./harness.js";
import { loadAgentScenarioFile } from "./scenario.js";
import type { AgentRunVerdict } from "./types.js";

interface AgentCliArgs {
  agent: string;
  runs: number;
  agentsDir: string;
  scenariosDir: string;
  concurrency: number;
  scenarioFilter?: string;
  verbose: boolean;
}

const DEFAULT_AGENT_RUNS = 5;

function parseArgs(argv: string[]): AgentCliArgs {
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
  if (!out.agent) {
    throw new Error("Required: --agent <name>");
  }
  const concurrencyRaw =
    out.concurrency ??
    process.env.AGENT_GATE_EVAL_CONCURRENCY ??
    String(DEFAULT_GATE_EVAL_CONCURRENCY);
  const concurrency = parseInt(concurrencyRaw, 10);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${concurrencyRaw}"`);
  }
  return {
    agent: out.agent,
    runs: parseInt(out.runs ?? String(DEFAULT_AGENT_RUNS), 10),
    agentsDir: out["agents-dir"] ?? "plugin/agents",
    scenariosDir: out["scenarios-dir"] ?? "internal/agent-gate-eval/scenarios",
    concurrency: concurrency,
    scenarioFilter: out.scenario,
    verbose: flags.has("verbose"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const definition = loadAgentDefinition(args.agentsDir, args.agent);
  const scenarioFilePath = path.resolve(args.scenariosDir, `${args.agent}.json`);
  if (!fs.existsSync(scenarioFilePath)) {
    throw new Error(`No scenario file at ${scenarioFilePath}`);
  }
  const scenarioFile = loadAgentScenarioFile(scenarioFilePath);
  if (scenarioFile.agent !== definition.name) {
    throw new Error(
      `Scenario file is for agent ${scenarioFile.agent}, not ${definition.name}`,
    );
  }
  // eslint-disable-next-line no-console
  console.error(
    `[agent-gate-eval] ${definition.name} — model=${definition.model} (pin: ${definition.modelAlias}) runs=${args.runs} concurrency=${args.concurrency}`,
  );

  const filteredScenarios = args.scenarioFilter
    ? scenarioFile.scenarios.filter((s) => s.name.includes(args.scenarioFilter!))
    : scenarioFile.scenarios;
  if (filteredScenarios.length === 0) {
    throw new Error(
      `No scenarios match --scenario "${args.scenarioFilter}" — available: ${scenarioFile.scenarios.map((s) => s.name).join(", ")}`,
    );
  }

  const throttleGate = new ThrottleGate();
  const repJobs = filteredScenarios.flatMap((scenario, scenarioIndex) =>
    Array.from({ length: args.runs }, (_, repIndex) => {
      const repLabel = `${scenario.name} (rep ${repIndex + 1}/${args.runs})`;
      return async (): Promise<{ scenarioIndex: number; verdict: AgentRunVerdict }> => {
        // eslint-disable-next-line no-console
        console.error(`[agent-gate-eval] running ${repLabel}…`);
        // A rep the SDK kills mid-run (context breaker, transport error) is a
        // failed rep, not a crashed suite — the other reps' evidence must
        // survive it. Throttle errors are retried upstream, never counted.
        let verdict: AgentRunVerdict;
        try {
          verdict = await withThrottleRetry(
            () =>
              runAgentScenarioOnce(
                {
                  definition: definition,
                  scenario: scenario,
                },
                args.verbose
                  ? (msg) => process.stderr.write(`[sdk ${repLabel}] ${oneLine(msg)}\n`)
                  : undefined,
              ),
            {
              gate: throttleGate,
              onThrottle: (attempt, backoffMs, error) => {
                // eslint-disable-next-line no-console
                console.error(
                  `[agent-gate-eval] ${repLabel}: rate-limited (attempt ${attempt}) — backing off ${Math.round(backoffMs / 1000)}s: ${oneLine(String(error))}`,
                );
              },
            },
          );
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(
            `[agent-gate-eval] ${repLabel}: run aborted by SDK error — counted as a failed rep: ${oneLine(String(error))}`,
          );
          verdict = {
            scenario: scenario.name,
            pass: false,
            reasons: [`run aborted by SDK error: ${String(error).slice(0, 300)}`],
            trace: { finalOutput: "", toolAttempts: [], askQuestionCount: 0 },
          };
        }
        if (args.verbose) {
          // eslint-disable-next-line no-console
          console.error(JSON.stringify(verdict, null, 2));
        }
        return { scenarioIndex: scenarioIndex, verdict: verdict };
      };
    }),
  );
  const repOutcomes = await runWithConcurrencyLimit(repJobs, args.concurrency);

  const verdictsByScenario: AgentRunVerdict[][] = filteredScenarios.map(() => []);
  for (const outcome of repOutcomes) {
    verdictsByScenario[outcome.scenarioIndex].push(outcome.verdict);
  }

  const reports = filteredScenarios.map((scenario, scenarioIndex) => {
    const verdicts = verdictsByScenario[scenarioIndex];
    const passes = verdicts.filter((v) => v.pass).length;
    const passRate = passes / verdicts.length;
    const failureReasons = Array.from(new Set(verdicts.flatMap((v) => v.reasons)));
    return {
      name: scenario.name,
      runs: verdicts.length,
      passes: passes,
      passRate: passRate,
      passed: passRate >= PASS_THRESHOLD,
      failureReasons: failureReasons,
    };
  });

  const resultsPath = path.resolve(
    path.dirname(scenarioFilePath),
    `${args.agent}.results.json`,
  );
  fs.writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        agent: definition.name,
        model: definition.model,
        modelAlias: definition.modelAlias,
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
    `[agent-gate-eval] ${definition.name}: ${reports.filter((r) => r.passed).length}/${reports.length} scenarios passed @ ≥${(PASS_THRESHOLD * 100).toFixed(0)}%`,
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
