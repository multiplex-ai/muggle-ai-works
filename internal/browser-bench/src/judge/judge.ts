import { BenchmarkOutcome } from "../domain/types";

/** WebVoyager's judge answers with a trailing `Status: SUCCESS` line; anything else is a failure. */
const SUCCESS_PATTERN = /Status:\s*SUCCESS\b/i;

/**
 * Scores one task attempt by WebVoyager's judge protocol: the judge model reads
 * the instruction, the agent's answer, and the trailing screenshots, and returns
 * a binary verdict. Model invocation is injected so the protocol stays testable
 * without a network call; call the judge at temperature 0 so verdicts reproduce.
 *
 * A response the judge protocol cannot parse counts as a failure, never an
 * error — infrastructure classification belongs to the orchestrator, and
 * letting the judge mint errors would quietly shrink the scored denominator.
 *
 * Output shape: `{ outcome: "pass", reasoning: "<raw judge text>" }`
 */
export const judgeTaskAsync = async ({
  instruction,
  finalAnswer,
  screenshotPaths,
  invokeJudgeAsync,
}: {
  instruction: string;
  finalAnswer: string;
  screenshotPaths: string[];
  invokeJudgeAsync: (prompt: string, screenshotPaths: string[]) => Promise<string>;
}): Promise<{ outcome: BenchmarkOutcome; reasoning: string }> => {
  const prompt =
    `You are evaluating whether a web agent completed its task.\n\n` +
    `Task: ${instruction}\n\n` +
    `Agent's final answer: ${finalAnswer}\n\n` +
    `The screenshots show the agent's last actions. Decide whether the task was ` +
    `completed. Reply with your reasoning, then a final line reading exactly ` +
    `"Status: SUCCESS" or "Status: NOT SUCCESS".`;

  const reasoning = await invokeJudgeAsync(prompt, screenshotPaths);

  return {
    outcome: SUCCESS_PATTERN.test(reasoning) ? BenchmarkOutcome.Pass : BenchmarkOutcome.Fail,
    reasoning: reasoning,
  };
};
