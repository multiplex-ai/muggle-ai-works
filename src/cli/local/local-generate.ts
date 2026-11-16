/**
 * `muggle generate --local` CLI handler.
 *
 * Generates a test script in the local studio through the same tool the MCP server exposes
 * (`muggle-local-execute-test-generation`), against the backend `MUGGLE_MCP_PROMPT_SERVICE_TARGET`
 * names, signed in with that target's session. The studio publishes the finished run to that
 * backend itself; this command reports the published ids.
 */

import { randomUUID } from "node:crypto";

import { getActiveRuntimeTarget, getLogger, localQa } from "@muggleai/mcp";

import { parseLocalGenerateArgs } from "./local-generate-args.js";
import { LOCAL_GENERATE_CANCEL_SIGNALS, LOCAL_GENERATE_COMMAND_LOG_LEVEL } from "./local-generate-constants.js";
import { fetchRemoteTestCaseAsync } from "./local-generate-remote.js";
import { toGenerationTestCase } from "./local-generate-test-case.js";
import {
  LocalGenerateStatus,
  type ILocalGenerateArgs,
  type ILocalGenerateCommandOptions,
  type ILocalGenerateResult,
} from "./local-generate-types.js";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The headline of a failure; the studio's full stdout and stderr stay in the run's artifacts. */
function toErrorHeadline(message: string): string {
  return message.split("\n").find((line) => line.trim() !== "")?.trim() ?? message;
}

function resolveStoredStatus(storedStatus: string | undefined): LocalGenerateStatus {
  switch (storedStatus) {
    case LocalGenerateStatus.Passed:
      return LocalGenerateStatus.Passed;
    case LocalGenerateStatus.Failed:
      return LocalGenerateStatus.Failed;
    case LocalGenerateStatus.Cancelled:
      return LocalGenerateStatus.Cancelled;
    default:
      return LocalGenerateStatus.Error;
  }
}

/** Asks every run this process started to stop; the studio then publishes what it recorded. */
function cancelActiveGenerations(): void {
  for (const activeExecution of localQa.listActiveExecutions()) {
    localQa.cancelExecution({ runId: activeExecution.runId });
  }
}

/**
 * Run one generation and report its outcome. Never throws: every failure becomes an `error` result.
 *
 * @param params.args - Validated command arguments.
 * @param params.commandStartedAt - Epoch milliseconds the command started.
 * @returns The result line to print.
 */
export async function runLocalGenerateAsync(params: {
  args: ILocalGenerateArgs;
  commandStartedAt: number;
}): Promise<ILocalGenerateResult> {
  const { args } = params;
  const correlationId = randomUUID();
  const buildResult = (resultFields: Omit<ILocalGenerateResult, "testCaseId" | "durationMs">): ILocalGenerateResult => ({
    status: resultFields.status,
    runId: resultFields.runId,
    testCaseId: args.testCaseId,
    actionScriptId: resultFields.actionScriptId,
    testScriptId: resultFields.testScriptId,
    durationMs: Date.now() - params.commandStartedAt,
    error: resultFields.error,
  });

  for (const signal of LOCAL_GENERATE_CANCEL_SIGNALS) {
    process.on(signal, cancelActiveGenerations);
  }
  try {
    const remoteTestCase = await fetchRemoteTestCaseAsync({ testCaseId: args.testCaseId, correlationId: correlationId });
    const testCase = toGenerationTestCase({ remoteTestCase: remoteTestCase, expectedProjectId: args.projectId });

    const toolResult = await localQa.executeTool(
      localQa.EXECUTE_TEST_GENERATION_TOOL_NAME,
      {
        testCase: testCase,
        localUrl: testCase.url,
        cwd: process.cwd(),
        showUi: args.isUiShown,
        lightMode: args.isLightMode,
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      },
      correlationId,
    );

    const generationRun = toolResult.data as localQa.ILocalExecutionRunResult | undefined;
    if (!generationRun?.id) {
      return buildResult({
        status: LocalGenerateStatus.Error,
        runId: null,
        actionScriptId: null,
        testScriptId: null,
        error: toErrorHeadline(toolResult.content),
      });
    }

    const storedRun = localQa.getRunResultStorageService().getRunResult(generationRun.id);
    const status = resolveStoredStatus(storedRun?.status ?? generationRun.status);
    const actionScriptId = storedRun?.cloudActionScriptId ?? null;
    const testScriptId = storedRun?.cloudTestScriptId ?? null;
    const failureMessage = storedRun?.errorMessage ?? generationRun.errorMessage;

    return buildResult({
      status: status,
      runId: generationRun.id,
      actionScriptId: actionScriptId,
      testScriptId: testScriptId,
      error: status === LocalGenerateStatus.Passed ? null : toErrorHeadline(failureMessage ?? `Run ended ${status}.`),
    });
  } catch (error) {
    return buildResult({
      status: LocalGenerateStatus.Error,
      runId: null,
      actionScriptId: null,
      testScriptId: null,
      error: toErrorHeadline(toErrorMessage(error)),
    });
  } finally {
    for (const signal of LOCAL_GENERATE_CANCEL_SIGNALS) {
      process.off(signal, cancelActiveGenerations);
    }
  }
}

function renderLocalGenerateText(generationOutcome: ILocalGenerateResult): string {
  return [
    `Generation ${generationOutcome.status} (target ${getActiveRuntimeTarget()})`,
    `  Test case:     ${generationOutcome.testCaseId}`,
    `  Local run:     ${generationOutcome.runId ?? "none"}`,
    `  Action script: ${generationOutcome.actionScriptId ?? "not published"}`,
    `  Test script:   ${generationOutcome.testScriptId ?? "not uploaded"}`,
    `  Duration:      ${generationOutcome.durationMs}ms`,
    ...(generationOutcome.error ? [`  Error:         ${generationOutcome.error}`] : []),
  ].join("\n");
}

/**
 * Generate a test script for one cloud test case in the local studio and print the outcome.
 *
 * Exits 0 whenever a result was printed, whatever the run's status; exits 1 only when the
 * arguments are invalid or `--local` is missing.
 *
 * @param options - `--local`, `--project-id`, `--test-case-id`, `--light`, `--show-ui`, `--timeout-ms`, `--json`.
 */
export async function generateCommand(options: ILocalGenerateCommandOptions): Promise<void> {
  const commandStartedAt = Date.now();
  let args: ILocalGenerateArgs;
  try {
    args = parseLocalGenerateArgs(options);
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
    return;
  }

  getLogger().level = LOCAL_GENERATE_COMMAND_LOG_LEVEL;
  const generationOutcome = await runLocalGenerateAsync({ args: args, commandStartedAt: commandStartedAt });
  process.stdout.write(
    args.isJsonOutput ? `${JSON.stringify(generationOutcome)}\n` : `${renderLocalGenerateText(generationOutcome)}\n`,
  );
  process.exitCode = 0;
}
