/**
 * CLI entrypoint: run scenario suites N times per scenario, aggregate
 * per-scenario pass rates, and write each suite's results beside its file.
 *
 * Usage:
 *   tsx internal/agent-gate-eval/src/run.ts \
 *     [--suite <file stem>]       # one scenario file, e.g. muggle-do.handoff; unset, every file
 *     [--agent <name>]            # legacy --suite that also requires an agent target
 *     [--runs 5] \
 *     [--agents-dir plugin/agents] [--skills-dir plugin/skills] \
 *     [--scenarios-dir internal/agent-gate-eval/scenarios] \
 *     [--concurrency 8]           # parallel reps; AGENT_GATE_EVAL_CONCURRENCY env also works
 *     [--scenario <substring>]    # only run scenarios whose name contains this
 *     [--cadence pr|nightly]      # pr drops nightly-only scenarios; unset runs all
 *     [--model <id|alias>]        # skill targets' model (else the skill's pin, else DEFAULT_SKILL_MODEL)
 *     [--verbose]                 # dump per-run trace to stderr
 *     [--host codex]              # run the reps in the Codex CLI (codex-harness.ts); agent targets only
 *     [--codex-home <dir>]        # under Codex: a Codex home the eval may own (default: a fresh one)
 *     [--codex-config <key=value>] # under Codex: a config override for every run (repeatable)
 *
 * An agent target always runs on its frontmatter pin — the pinned model
 * honoring the contract IS what this eval gates — so `--model` leaves agents
 * alone under the agent SDK. Codex ignores the pin and runs every agent on the
 * session's model, so under Codex `--model` picks that model. Each suite's
 * pass bar is its file's `passThreshold`, else PASS_THRESHOLD.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  runWithConcurrencyLimit,
  ThrottleGate,
  withThrottleRetry,
} from "../../skill-gate-eval/src/concurrency.js";
import { PASS_THRESHOLD } from "../../skill-gate-eval/src/constants.js";
import { EvalHost } from "../../skill-gate-eval/src/types.js";
import { parseEvalCliArgs } from "./cli-args.js";
import { codexUnsupportedFeatures, prepareCodexAgentHome, runAgentScenarioOnceInCodex } from "./codex-harness.js";
import { formatFailedRunTrace } from "./failed-run-trace.js";
import { runAgentScenarioOnce } from "./harness.js";
import { loadScenarioSuites, scenariosForCadence } from "./scenario.js";
import { suiteResultsPath, summarizeScenarioVerdicts } from "./suite-report.js";
import { loadTargetDefinition } from "./target-definition.js";
import { isUsageLimitError } from "./usage-limit.js";
import {
  EvalTargetKind,
  type AgentRunVerdict,
  type AgentScenario,
  type EvalCliArgs,
  type PlannedSuite,
  type SuiteResults,
  type TargetDefinition,
} from "./types.js";

function oneLine(msg: unknown): string {
  const s = JSON.stringify(msg);
  return s.length > 500 ? s.slice(0, 500) + "…" : s;
}

function modelLabelOf(definition: TargetDefinition, args: EvalCliArgs): string {
  return args.host === EvalHost.Codex ? (args.model ?? "codex default") : definition.model;
}

function planSuites(args: EvalCliArgs): PlannedSuite[] {
  const planned: PlannedSuite[] = [];
  let droppedByCadence = 0;
  for (const suite of loadScenarioSuites(args.scenariosDir, args.suite)) {
    const target = suite.file.target;
    if (args.requireAgentTarget && target.kind !== EvalTargetKind.Agent) {
      throw new Error(`--agent runs agent suites; ${suite.stem} targets ${target.kind} ${target.name} — name it with --suite`);
    }
    if (args.host === EvalHost.Codex && target.kind !== EvalTargetKind.Agent) {
      throw new Error(`${suite.stem} targets ${target.kind} ${target.name}; the Codex harness runs agent targets only`);
    }
    const definition = loadTargetDefinition(
      target,
      { agentsDir: args.agentsDir, skillsDir: args.skillsDir },
      args.host === EvalHost.Claude ? args.model : undefined,
    );
    const byCadence = scenariosForCadence(suite.file.scenarios, args.cadence);
    droppedByCadence += suite.file.scenarios.length - byCadence.length;
    const scenarios = args.scenarioFilter
      ? byCadence.filter((scenario) => scenario.name.includes(args.scenarioFilter!))
      : byCadence;
    if (args.host === EvalHost.Codex) {
      for (const scenario of scenarios) {
        const unsupported = codexUnsupportedFeatures(scenario);
        if (unsupported.length > 0) {
          throw new Error(`${suite.stem}/${scenario.name} uses ${unsupported.join(", ")}, which the Codex harness cannot run`);
        }
      }
    }
    if (scenarios.length === 0) continue;
    planned.push({
      suite: suite,
      definition: definition,
      scenarios: scenarios,
      passThreshold: suite.file.passThreshold ?? PASS_THRESHOLD,
    });
  }
  if (droppedByCadence > 0) {
    console.error(`[agent-gate-eval] --cadence ${args.cadence} dropped ${droppedByCadence} nightly-only scenario(s)`);
  }
  if (planned.length === 0) {
    throw new Error(
      `Nothing to run: no scenario matches${args.suite ? ` in suite ${args.suite}` : ""}${args.scenarioFilter ? ` --scenario "${args.scenarioFilter}"` : ""}${args.cadence ? ` at --cadence ${args.cadence}` : ""}`,
    );
  }
  return planned;
}

async function main(): Promise<void> {
  const args = parseEvalCliArgs(process.argv.slice(2));
  const planned = planSuites(args);
  for (const { suite, definition, scenarios, passThreshold } of planned) {
    console.error(
      `[agent-gate-eval] ${suite.stem} (${definition.kind} ${definition.name}) — host=${args.host} model=${modelLabelOf(definition, args)} (pin: ${definition.modelAlias ?? "none"}) scenarios=${scenarios.length} runs=${args.runs} threshold=${passThreshold} concurrency=${args.concurrency}`,
    );
  }

  const codexHome =
    args.host === EvalHost.Codex
      ? path.resolve(args.codexHome ?? fs.mkdtempSync(path.join(os.tmpdir(), "muggle-agent-eval-codex-")))
      : "";
  if (args.host === EvalHost.Codex) prepareCodexAgentHome(codexHome);
  const runRep = (
    definition: TargetDefinition,
    scenario: AgentScenario,
    onEvent?: (event: unknown) => void,
  ): Promise<AgentRunVerdict> => {
    if (args.host === EvalHost.Codex && definition.kind === EvalTargetKind.Agent) {
      return runAgentScenarioOnceInCodex(
        {
          definition: definition,
          scenario: scenario,
          codexHome: codexHome,
          codexModel: args.model,
          sandbox: process.env.MUGGLE_CODEX_SANDBOX,
          configOverrides: args.codexConfig,
        },
        onEvent,
      );
    }
    return runAgentScenarioOnce({ definition: definition, scenario: scenario }, onEvent);
  };

  const throttleGate = new ThrottleGate();
  const repJobs = planned.flatMap((plannedSuite, suiteIndex) =>
    plannedSuite.scenarios.flatMap((scenario, scenarioIndex) =>
      Array.from({ length: args.runs }, (_, repIndex) => {
        const repLabel = `${plannedSuite.suite.stem}/${scenario.name} (rep ${repIndex + 1}/${args.runs})`;
        return async (): Promise<{ suiteIndex: number; scenarioIndex: number; verdict: AgentRunVerdict }> => {
          console.error(`[agent-gate-eval] running ${repLabel}…`);
          // A rep the SDK kills mid-run (context breaker, transport error) is a
          // failed rep, not a crashed suite — the other reps' evidence must
          // survive it. Throttle errors are retried upstream, never counted.
          let verdict: AgentRunVerdict;
          try {
            verdict = await withThrottleRetry(
              () =>
                runRep(
                  plannedSuite.definition,
                  scenario,
                  args.verbose
                    ? (msg) => process.stderr.write(`[sdk ${repLabel}] ${oneLine(msg)}\n`)
                    : undefined,
                ),
              {
                gate: throttleGate,
                onThrottle: (attempt, backoffMs, error) => {
                  console.error(
                    `[agent-gate-eval] ${repLabel}: rate-limited (attempt ${attempt}) — backing off ${Math.round(backoffMs / 1000)}s: ${oneLine(String(error))}`,
                  );
                },
              },
            );
          } catch (error) {
            const isUsageLimited = isUsageLimitError(error);
            console.error(
              `[agent-gate-eval] ${repLabel}: run aborted by SDK error — counted as ${isUsageLimited ? "no result (usage limit)" : "a failed rep"}: ${oneLine(String(error))}`,
            );
            verdict = {
              scenario: scenario.name,
              pass: false,
              reasons: [`run aborted by SDK error: ${String(error).slice(0, 300)}`],
              trace: { finalOutput: "", toolAttempts: [], askQuestionCount: 0 },
              isInconclusive: isUsageLimited,
            };
          }
          const usage = verdict.usage;
          console.error(
            `[agent-gate-eval] ${repLabel}: ${verdict.pass ? "PASS" : "FAIL"}${usage ? ` — $${usage.costUsd.toFixed(2)}, ${Math.round(usage.durationMs / 1000)}s, ${usage.turns} turns` : ""}`,
          );
          if (args.verbose) {
            console.error(JSON.stringify(verdict, null, 2));
          } else {
            for (const line of formatFailedRunTrace(verdict)) console.error(line);
          }
          return { suiteIndex: suiteIndex, scenarioIndex: scenarioIndex, verdict: verdict };
        };
      }),
    ),
  );
  const repOutcomes = await runWithConcurrencyLimit(repJobs, args.concurrency);

  const verdictsBySuite: AgentRunVerdict[][][] = planned.map((plannedSuite) => plannedSuite.scenarios.map(() => []));
  for (const outcome of repOutcomes) {
    verdictsBySuite[outcome.suiteIndex][outcome.scenarioIndex].push(outcome.verdict);
  }

  let allPassed = true;
  planned.forEach((plannedSuite, suiteIndex) => {
    const { suite, definition, scenarios, passThreshold } = plannedSuite;
    const reports = scenarios.map((scenario, scenarioIndex) =>
      summarizeScenarioVerdicts(scenario.name, verdictsBySuite[suiteIndex][scenarioIndex], passThreshold),
    );
    const results: SuiteResults = {
      suite: suite.stem,
      target: suite.file.target,
      ...(definition.kind === EvalTargetKind.Agent ? { agent: definition.name } : {}),
      host: args.host,
      model: modelLabelOf(definition, args),
      modelAlias: definition.modelAlias ?? null,
      runsPerScenario: args.runs,
      passThreshold: passThreshold,
      recordedAt: new Date().toISOString(),
      scenarios: reports,
    };
    fs.writeFileSync(suiteResultsPath(suite, args.host), JSON.stringify(results, null, 2));

    allPassed = allPassed && reports.every((report) => report.passed);
    console.log(
      `[agent-gate-eval] ${suite.stem}: ${reports.filter((report) => report.passed).length}/${reports.length} scenarios passed @ ≥${(passThreshold * 100).toFixed(0)}%`,
    );
    for (const report of reports) {
      const meanSpend =
        report.meanCostUsd === null || report.meanDurationMs === null
          ? ""
          : `, mean $${report.meanCostUsd.toFixed(2)} / ${Math.round(report.meanDurationMs / 1000)}s per run`;
      const noResult = report.inconclusiveRuns > 0 ? `, ${report.inconclusiveRuns} no result (usage limit)` : "";
      console.log(
        `  ${report.passed ? "PASS" : "FAIL"}  ${report.name}  (${report.passes}/${report.runs} = ${(report.passRate * 100).toFixed(1)}%${noResult}${meanSpend})`,
      );
      for (const reason of report.failureReasons) {
        console.log(`    - ${reason}`);
      }
    }
  });
  process.exit(allPassed ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(2);
});
