import { resolveArmFloorEvidence } from "./armFloors.js";
import {
  CI_FLAG,
  HEAD_FLAG,
  PR_KEY_FLAG,
  PR_WATCH_VERDICT_USAGE,
  REBASE_DUE_FLAG,
  REBASE_DUE_YES,
  REBASE_KEY_FLAG,
  USAGE_EXIT_CODE,
} from "./constants.js";
import { lastSeenEntryFor } from "./slotFiles.js";
import { resolveWatchTickVerdict } from "./tickVerdict.js";
import {
  CiRollupBucket,
  PrWatchVerdictCommand,
  type PrWatchVerdictArguments,
  type PrWatchVerdictOutcome,
  type WatchPreferences,
} from "./types.js";

/** The `--flag value` pairs after the subcommand; a flag with no value reads as empty. */
export function parseVerdictArguments(flagTokens: string[]): PrWatchVerdictArguments {
  const parsed: PrWatchVerdictArguments = {};
  for (let index = 0; index < flagTokens.length; index += 1) {
    const token = flagTokens[index];
    if (!token.startsWith("--")) continue;
    const next = flagTokens[index + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    parsed[token.slice(2)] = hasValue ? next : "";
    if (hasValue) index += 1;
  }
  return parsed;
}

const usageFailure = (problem: string): PrWatchVerdictOutcome => ({
  stdout: "",
  stderr: `pr-watch-verdict: ${problem}\n${PR_WATCH_VERDICT_USAGE}\n`,
  exitCode: USAGE_EXIT_CODE,
});

/**
 * Run one `pr-watch-verdict.mjs` invocation against a slot's `last_seen.json` text.
 *
 * Output shape: `arm-floors` prints `REBASE_ATTEMPTED=0\nCI_ATTEMPTED=1\nBLOCKED_CIDIGEST=<digest>\n`;
 * `tick` prints `VERDICT=dispatch-rebase\n`.
 */
export function runPrWatchVerdictCommand(
  commandLine: string[],
  lastSeenJson: string,
  resolvePreferences: () => WatchPreferences,
): PrWatchVerdictOutcome {
  const [subcommand, ...flagTokens] = commandLine;
  const flags = parseVerdictArguments(flagTokens);
  const prKey = flags[PR_KEY_FLAG];
  if (!prKey) return usageFailure(`--${PR_KEY_FLAG} is required`);
  const lastSeenEntry = lastSeenEntryFor(lastSeenJson, prKey);
  const headSha = flags[HEAD_FLAG] ?? "";
  const rebaseKey = flags[REBASE_KEY_FLAG] ?? "";

  if (subcommand === PrWatchVerdictCommand.ArmFloors) {
    const evidence = resolveArmFloorEvidence(lastSeenEntry, headSha, rebaseKey);
    return {
      stdout:
        `REBASE_ATTEMPTED=${evidence.isRebaseKeyAttempted ? 1 : 0}\n` +
        `CI_ATTEMPTED=${evidence.isCiHeadAttempted ? 1 : 0}\n` +
        `BLOCKED_CIDIGEST=${evidence.blockedCiDigest}\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  if (subcommand === PrWatchVerdictCommand.Tick) {
    const ciBucket = Object.values(CiRollupBucket).find((bucket) => bucket === flags[CI_FLAG]);
    if (!ciBucket) return usageFailure(`--${CI_FLAG} must be one of ${Object.values(CiRollupBucket).join(", ")}`);
    if (!headSha || !rebaseKey) return usageFailure(`--${HEAD_FLAG} and --${REBASE_KEY_FLAG} are required`);
    const verdict = resolveWatchTickVerdict(
      lastSeenEntry,
      { headSha: headSha, rebaseKey: rebaseKey, isRebaseDue: flags[REBASE_DUE_FLAG] === REBASE_DUE_YES, ciBucket: ciBucket },
      resolvePreferences(),
    );
    return { stdout: `VERDICT=${verdict}\n`, stderr: "", exitCode: 0 };
  }

  return usageFailure(`unknown subcommand ${subcommand ?? "(none)"}`);
}
