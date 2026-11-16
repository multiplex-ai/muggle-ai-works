import { LOCAL_FLAG_REQUIRED_MESSAGE } from "./local-generate-constants.js";
import type { ILocalGenerateArgs, ILocalGenerateCommandOptions } from "./local-generate-types.js";

function requireNonEmptyOption(params: { value: string | undefined; flagName: string }): string {
  const trimmedValue = params.value?.trim() ?? "";
  if (trimmedValue === "") {
    throw new Error(`${params.flagName} is required.`);
  }
  return trimmedValue;
}

function parseTimeoutMs(rawTimeoutMs: string | undefined): number | undefined {
  if (rawTimeoutMs === undefined) {
    return undefined;
  }
  const timeoutMs = Number(rawTimeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`--timeout-ms must be a positive integer, got '${rawTimeoutMs}'.`);
  }
  return timeoutMs;
}

/**
 * Validate the options of `muggle generate --local`.
 *
 * @param options - Options as Commander parsed them.
 * @returns The validated arguments.
 * @throws Error when `--local` is missing, naming the flag when an id is missing or the timeout is not a positive integer.
 */
export function parseLocalGenerateArgs(options: ILocalGenerateCommandOptions): ILocalGenerateArgs {
  if (options.local !== true) {
    throw new Error(LOCAL_FLAG_REQUIRED_MESSAGE);
  }
  return {
    projectId: requireNonEmptyOption({ value: options.projectId, flagName: "--project-id" }),
    testCaseId: requireNonEmptyOption({ value: options.testCaseId, flagName: "--test-case-id" }),
    isLightMode: options.light === true,
    isUiShown: options.showUi === true,
    ...(options.timeoutMs !== undefined ? { timeoutMs: parseTimeoutMs(options.timeoutMs) } : {}),
    isJsonOutput: options.json === true,
  };
}
