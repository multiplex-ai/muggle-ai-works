/**
 * `muggle e2e-plan` CLI handler.
 *
 * Reads the test cases a local E2E run is about to execute from stdin and posts
 * them, each queued, to the PR's designated walkthrough comment. Each case's
 * result then fills its row as its run finishes, through the guardrail hook on
 * the execution tools. Prints `{"posted": <bool>, "prUrl": <url | null>}`.
 */

import { defaultPrWalkthroughLookup } from "../guardrails/walkthroughOwed.js";
import { noteE2ePlan } from "../pr-walkthrough/reserve.js";
import { E2ePlanSchema, type E2ePlanFlags } from "./e2e-plan-types.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Post a run's planned test cases to its PR.
 *
 * @param flags - `--pr`, `--cwd`.
 */
export async function e2ePlanCommand(flags: E2ePlanFlags): Promise<void> {
  let plan;
  try {
    plan = E2ePlanSchema.parse(JSON.parse(await readStdin()));
  } catch (error) {
    process.stderr.write(`e2e-plan: stdin must be a JSON array of {testCaseId, title}: ${String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  // The PR is the one on the tree under test's branch, which in a worktree
  // cycle is not the directory the session runs from.
  if (flags.cwd) process.chdir(flags.cwd);
  const prUrl = flags.pr ?? defaultPrWalkthroughLookup.branchPrUrl();
  const isPosted = prUrl !== null && noteE2ePlan(prUrl, plan);
  process.stdout.write(`${JSON.stringify({ posted: isPosted, prUrl: prUrl })}\n`);
}
