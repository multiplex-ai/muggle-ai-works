/**
 * Pure verdict logic for one eval run: asserts the captured final report,
 * tool-attempt trace, and sandbox artifacts against the scenario's `expect`
 * block. Kept side-effect-free so it is unit-testable without the SDK harness.
 */

import { isArtifactSatisfied } from "./sandbox/artifacts.js";
import { describeToolAttemptPattern, toolAttemptMatches } from "./tool-patterns.js";
import type {
  AgentRunVerdict,
  AgentScenario,
  ArtifactSnapshot,
  ToolAttempt,
  ToolAttemptPattern,
} from "./types.js";

/**
 * How many leading patterns the attempts satisfy in order, each by an attempt
 * after the one that satisfied the previous. Matching each pattern to its
 * earliest possible attempt is optimal, so this equals `patterns.length`
 * exactly when the patterns form an ordered subsequence of the attempts.
 */
export function countOrderedMatches(toolAttempts: ToolAttempt[], patterns: ToolAttemptPattern[]): number {
  let matched = 0;
  for (const attempt of toolAttempts) {
    if (matched < patterns.length && toolAttemptMatches(attempt, patterns[matched])) matched++;
  }
  return matched;
}

/**
 * Score one completed run. `finalOutput` is the run's terminal report text;
 * `artifactSnapshot` is the sandbox after the run, required when the scenario
 * expects artifacts.
 */
export function judgeAgentRun(
  scenario: AgentScenario,
  finalOutput: string,
  toolAttempts: ToolAttempt[],
  askQuestionCount: number,
  artifactSnapshot?: ArtifactSnapshot,
): AgentRunVerdict {
  const reasons: string[] = [];
  const expect = scenario.expect;

  for (const needle of expect.outputContains ?? []) {
    if (!finalOutput.includes(needle)) {
      reasons.push(`expected final report to contain ${JSON.stringify(needle)}`);
    }
  }
  for (const source of expect.outputMatches ?? []) {
    if (!new RegExp(source).test(finalOutput)) {
      reasons.push(`expected final report to match /${source}/`);
    }
  }
  for (const needle of expect.outputNotContains ?? []) {
    if (finalOutput.includes(needle)) {
      reasons.push(`expected final report NOT to contain ${JSON.stringify(needle)}`);
    }
  }
  for (const source of expect.outputNotMatches ?? []) {
    if (new RegExp(source).test(finalOutput)) {
      reasons.push(`expected final report NOT to match /${source}/`);
    }
  }

  for (const pattern of expect.requireToolAttempts ?? []) {
    if (!toolAttempts.some((a) => toolAttemptMatches(a, pattern))) {
      reasons.push(`expected an attempt matching ${describeToolAttemptPattern(pattern)}`);
    }
  }
  for (const pattern of expect.forbidToolAttempts ?? []) {
    if (toolAttempts.some((a) => toolAttemptMatches(a, pattern))) {
      reasons.push(`expected NO attempt matching ${describeToolAttemptPattern(pattern)}`);
    }
  }

  const sequence = expect.requireToolSequence ?? [];
  const orderedMatches = countOrderedMatches(toolAttempts, sequence);
  if (orderedMatches < sequence.length) {
    reasons.push(
      `expected tool sequence ${sequence.map(describeToolAttemptPattern).join(" → ")}; matched ${orderedMatches}/${sequence.length}, missing ${describeToolAttemptPattern(sequence[orderedMatches])} after the earlier steps`,
    );
  }

  for (const artifact of expect.requireArtifacts ?? []) {
    const label = `${artifact.path}${artifact.contains === undefined ? "" : ` containing ${JSON.stringify(artifact.contains)}`}`;
    if (!artifactSnapshot) {
      reasons.push(`expected artifact ${label}, but the run had no sandbox to inspect`);
    } else if (!isArtifactSatisfied(artifact, artifactSnapshot, toolAttempts)) {
      reasons.push(`expected artifact ${label} in the sandbox or named by a Write or Bash attempt`);
    }
  }

  const forbidAsk = expect.forbidAskUserQuestion ?? true;
  if (forbidAsk && askQuestionCount > 0) {
    reasons.push(
      `agent asked the user ${askQuestionCount} time(s) — the no-user-channel contract requires needs-input: instead`,
    );
  }

  return {
    scenario: scenario.name,
    pass: reasons.length === 0,
    reasons: reasons,
    trace: {
      finalOutput: finalOutput,
      toolAttempts: toolAttempts,
      askQuestionCount: askQuestionCount,
    },
  };
}
