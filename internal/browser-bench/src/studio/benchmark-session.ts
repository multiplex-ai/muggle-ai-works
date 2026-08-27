import { BENCHMARK_SESSION_ENV_VAR } from "./constants";

/**
 * Resolves the muggle session the batch runs under.
 *
 * Required rather than defaulted. A benchmark task carries no `projectId` and no
 * `organizationId`, and with both unset the studio's metering bills the executing
 * user's personal wallet — so falling back to whoever last ran `muggle login`
 * charges a real person for the batch, silently and at benchmark scale. Naming
 * the identity is the one thing that keeps that deliberate.
 *
 * Output shape: an absolute path to a muggle session file.
 *
 * @throws When the variable is unset or empty.
 */
export const resolveBenchmarkSessionPath = (env: NodeJS.ProcessEnv): string => {
  const sessionPath = env[BENCHMARK_SESSION_ENV_VAR];
  if (!sessionPath) {
    throw new Error(
      `${BENCHMARK_SESSION_ENV_VAR} is unset. Point it at the benchmark account's ` +
        `muggle session file — a batch bills the wallet of whichever identity it runs ` +
        `under, so it must not inherit a personal login.`,
    );
  }
  return sessionPath;
};
