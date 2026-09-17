/**
 * `muggle pr-walkthrough-check` CLI handler.
 *
 * Judges whether a PR's designated Muggle AI walkthrough comment is settled —
 * carrying the E2E walkthrough, or stating why E2E does not apply — and either
 * publishes the verdict as a check run or reports it through the exit code.
 */

import { runPrWalkthroughCheck } from "./pr-walkthrough/check.js";
import { resolveCheckTarget, type PrWalkthroughCheckFlags } from "./pr-walkthrough/target.js";

/**
 * Run the walkthrough check for the PR named by the flags or the Actions event.
 *
 * @param flags - `--repo`, `--pr`, `--head-sha`, `--check-run`.
 */
export async function prWalkthroughCheckCommand(flags: PrWalkthroughCheckFlags): Promise<void> {
  const target = resolveCheckTarget(flags, process.env);
  if (!target) {
    // Not a PR context (an issue comment, a manual run): nothing to judge, and
    // failing here would redden workflows that legitimately fire on both.
    process.stderr.write("pr-walkthrough-check: no pull request to judge\n");
    return;
  }

  const judgment = await runPrWalkthroughCheck(target);
  process.stdout.write(`${judgment.conclusion}: ${judgment.summary}\n`);
  process.exitCode = judgment.exitCode;
}
