/**
 * Pure verdict logic for one agent-eval run: asserts the captured final
 * report and tool-attempt trace against the scenario's `expect` block.
 * Kept side-effect-free so it is unit-testable without the SDK harness.
 */

import type {
  AgentRunVerdict,
  AgentScenario,
  ToolAttempt,
  ToolAttemptPattern,
} from "./types.js";

function attemptMatches(attempt: ToolAttempt, pattern: ToolAttemptPattern): boolean {
  if (attempt.tool !== pattern.tool) return false;
  return JSON.stringify(attempt.args ?? {}).includes(pattern.argContains);
}

/** Score one completed run. `finalOutput` is the agent's terminal report text. */
export function judgeAgentRun(
  scenario: AgentScenario,
  finalOutput: string,
  toolAttempts: ToolAttempt[],
  askQuestionCount: number,
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
    if (!toolAttempts.some((a) => attemptMatches(a, pattern))) {
      reasons.push(
        `expected an attempt of ${pattern.tool} with input containing ${JSON.stringify(pattern.argContains)}`,
      );
    }
  }
  for (const pattern of expect.forbidToolAttempts ?? []) {
    if (toolAttempts.some((a) => attemptMatches(a, pattern))) {
      reasons.push(
        `expected NO attempt of ${pattern.tool} with input containing ${JSON.stringify(pattern.argContains)}`,
      );
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
