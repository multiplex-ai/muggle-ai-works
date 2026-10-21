/** Parses the agent-gate eval runner's command line (run.ts documents the flags). */

import { DEFAULT_GATE_EVAL_CONCURRENCY } from "../../skill-gate-eval/src/constants.js";
import { EvalHost } from "../../skill-gate-eval/src/types.js";
import { DEFAULT_AGENT_RUNS } from "./constants.js";
import { ScenarioCadence, type EvalCliArgs } from "./types.js";

function parsePositiveInteger(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${flag} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

/**
 * Parse argv (without the node and script entries).
 *
 * Output shape: `EvalCliArgs` — `--suite` and the legacy `--agent` both name one
 * scenario file by stem; `--agent` additionally requires that file to target an agent.
 *
 * @throws on an unknown host or cadence, a non-positive count, or both `--suite` and `--agent`.
 */
export function parseEvalCliArgs(argv: string[]): EvalCliArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const codexConfig: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(key);
      continue;
    }
    if (key === "codex-config") codexConfig.push(next);
    else values[key] = next;
    i++;
  }
  if (values.suite && values.agent) {
    throw new Error("Pass --suite or --agent, not both");
  }
  const host = (values.host ?? EvalHost.Claude) as EvalHost;
  if (!Object.values(EvalHost).includes(host)) {
    throw new Error(`--host must be one of ${Object.values(EvalHost).join(", ")}, got "${values.host}"`);
  }
  const cadence = values.cadence as ScenarioCadence | undefined;
  if (cadence !== undefined && !Object.values(ScenarioCadence).includes(cadence)) {
    throw new Error(`--cadence must be one of ${Object.values(ScenarioCadence).join(", ")}, got "${values.cadence}"`);
  }
  const concurrencyRaw =
    values.concurrency ?? process.env.AGENT_GATE_EVAL_CONCURRENCY ?? String(DEFAULT_GATE_EVAL_CONCURRENCY);
  return {
    suite: values.suite ?? values.agent,
    requireAgentTarget: values.agent !== undefined,
    runs: parsePositiveInteger(values.runs ?? String(DEFAULT_AGENT_RUNS), "runs"),
    agentsDir: values["agents-dir"] ?? "plugin/agents",
    skillsDir: values["skills-dir"] ?? "plugin/skills",
    scenariosDir: values["scenarios-dir"] ?? "internal/agent-gate-eval/scenarios",
    concurrency: parsePositiveInteger(concurrencyRaw, "concurrency"),
    scenarioFilter: values.scenario,
    cadence: cadence,
    verbose: flags.has("verbose"),
    host: host,
    model: values.model,
    codexHome: values["codex-home"],
    codexConfig: codexConfig,
  };
}
