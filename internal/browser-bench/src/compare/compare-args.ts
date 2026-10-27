import { CompareCliFlag, type CompareCliOptions } from "./types";

/**
 * Resolves `compare.ts` arguments: the baseline and candidate batch directories, both required.
 *
 * Output shape: `{ baselineDir: "reports/api", candidateDir: "reports/claude-code" }`
 *
 * @throws When a flag is unknown, missing its value, or either directory is not given.
 */
export const parseCompareArgs = (argv: string[]): CompareCliOptions => {
  let baselineDir: string | undefined;
  let candidateDir: string | undefined;

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value.`);
    }
    switch (flag) {
      case CompareCliFlag.Baseline:
        baselineDir = value;
        break;
      case CompareCliFlag.Candidate:
        candidateDir = value;
        break;
      default:
        throw new Error(`Unknown flag ${flag}. Accepted: ${Object.values(CompareCliFlag).join(", ")}.`);
    }
  }

  if (baselineDir === undefined || candidateDir === undefined) {
    throw new Error(
      `Both ${CompareCliFlag.Baseline} and ${CompareCliFlag.Candidate} are required — each a run.ts --out directory.`,
    );
  }
  return { baselineDir: baselineDir, candidateDir: candidateDir };
};
