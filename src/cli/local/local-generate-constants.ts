import type { IRemoteTestCaseRecord } from "./local-generate-types.js";

/** Why `muggle generate` without `--local` exits non-zero. */
export const LOCAL_FLAG_REQUIRED_MESSAGE =
  "Only local generation is supported from the CLI: pass --local to run it in the local Studio.";

/** Log threshold while `muggle generate --local` runs, so only the result reaches the terminal. */
export const LOCAL_GENERATE_COMMAND_LOG_LEVEL = "warn";

/** Tolerance between this machine's clock and the backend's when matching the run the studio published. */
export const UPLOADED_RUN_CLOCK_SKEW_MS = 60_000;

/** Signals that cancel an in-flight generation so the studio still publishes what it recorded. */
export const LOCAL_GENERATE_CANCEL_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

/** Fields copied from the cloud test case; `instructions` is per-run text, so it is never copied. */
export const COPIED_TEST_CASE_FIELDS: Array<keyof IRemoteTestCaseRecord> = [
  "id",
  "title",
  "description",
  "goal",
  "expectedResult",
  "precondition",
  "url",
  "projectId",
  "useCaseId",
  "displayOptions",
  "pinnedAccount",
  "alwaysStartsFreshSession",
];
