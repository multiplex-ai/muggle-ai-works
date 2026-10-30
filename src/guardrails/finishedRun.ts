import { E2eProgressStatus, type E2eProgressCase } from "../pr-walkthrough/types.js";
import {
  MUGGLE_EXECUTION_TOOL,
  MUGGLE_RUN_ID_LINE,
  MUGGLE_RUN_PASSED_STATUS,
  MUGGLE_RUN_STATUS_LINE,
  MUGGLE_RUN_VIEW_URL_LINE,
} from "./constants.js";
import { flattenToolResponse } from "./toolResponse.js";
import type { HookInput } from "./types.js";

/**
 * The test case a finished local execution ran, as a row of the PR's progress table.
 *
 * Only a call that produced a run counts — one refused before the browser
 * started prints no run id, and nothing ran for a reviewer to see.
 *
 * Output shape: `{ testCaseId: "tc-1", title: "Login", status: "passed", viewUrl: "https://…" }`
 */
export function detectFinishedRun(input: HookInput): E2eProgressCase | undefined {
  if (!MUGGLE_EXECUTION_TOOL.test(input.tool_name ?? "")) return undefined;
  const rendered = flattenToolResponse(input.tool_response);
  const status = MUGGLE_RUN_STATUS_LINE.exec(rendered)?.[1];
  if (!status || !MUGGLE_RUN_ID_LINE.test(rendered)) return undefined;
  const testCaseId = input.tool_input?.testCase?.id ?? input.tool_input?.testScript?.testCaseId;
  if (!testCaseId) return undefined;
  const viewUrl = MUGGLE_RUN_VIEW_URL_LINE.exec(rendered)?.[1];
  return {
    testCaseId: testCaseId,
    title: input.tool_input?.testCase?.title ?? input.tool_input?.testScript?.name ?? testCaseId,
    status: status.toLowerCase() === MUGGLE_RUN_PASSED_STATUS ? E2eProgressStatus.Passed : E2eProgressStatus.Failed,
    ...(viewUrl ? { viewUrl: viewUrl } : {}),
  };
}
