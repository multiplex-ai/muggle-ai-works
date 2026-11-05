/**
 * Upstream calls of the test case update tool: the definition write and the state write that carries status.
 */

import type { z } from "zod";

import type { TestCaseUpdateInputSchema } from "../../e2e/contracts/index.js";
import type { IUpstreamCall } from "../../e2e/types.js";
import { pickTestCaseTestStateFields } from "./test-state-upstream.js";
import { MUGGLE_TEST_PREFIX } from "./upstream-route-constants.js";

type TestCaseUpdateInput = z.infer<typeof TestCaseUpdateInputSchema>;

/**
 * Builds the definition write body for a test case update: every provided field except status, which the
 * definition write drops and only the state endpoint stores.
 * @param toolInput - The validated update tool input.
 * @returns e.g. `{ id: "<uuid>", title: "Renamed", resultStateId: null }`.
 */
export function buildTestCaseDefinitionUpdateBody(toolInput: TestCaseUpdateInput): Record<string, unknown> {
  const definitionBody: Record<string, unknown> = { id: toolInput.testCaseId, ...pickTestCaseTestStateFields(toolInput) };
  if (toolInput.title !== undefined) definitionBody.title = toolInput.title;
  if (toolInput.description !== undefined) definitionBody.description = toolInput.description;
  if (toolInput.goal !== undefined) definitionBody.goal = toolInput.goal;
  if (toolInput.precondition !== undefined) definitionBody.precondition = toolInput.precondition;
  if (toolInput.expectedResult !== undefined) definitionBody.expectedResult = toolInput.expectedResult;
  if (toolInput.url !== undefined) definitionBody.url = toolInput.url;
  if (toolInput.priority !== undefined) definitionBody.priority = toolInput.priority;
  if (toolInput.tags !== undefined) definitionBody.tags = toolInput.tags;
  if (toolInput.category !== undefined) definitionBody.category = toolInput.category;
  if (toolInput.automated !== undefined) definitionBody.automated = toolInput.automated;
  if (toolInput.pinnedAccount !== undefined) definitionBody.pinnedAccount = toolInput.pinnedAccount;
  if (toolInput.alwaysStartsFreshSession !== undefined) {
    definitionBody.alwaysStartsFreshSession = toolInput.alwaysStartsFreshSession;
  }
  return definitionBody;
}

/**
 * Whether a test case update changes any definition field, as opposed to status alone.
 * @param toolInput - The validated update tool input.
 */
export function hasTestCaseDefinitionEdit(toolInput: TestCaseUpdateInput): boolean {
  return Object.keys(buildTestCaseDefinitionUpdateBody(toolInput)).some((fieldName) => fieldName !== "id");
}

/**
 * Builds the state write that changes a test case's status; the backend checks it against the lifecycle.
 * @param testCaseId - The test case to change.
 * @param status - The requested status.
 */
export function buildTestCaseStatusUpdateCall(
  testCaseId: string,
  status: NonNullable<TestCaseUpdateInput["status"]>,
): IUpstreamCall {
  return {
    method: "PUT",
    path: `${MUGGLE_TEST_PREFIX}/test-cases/${testCaseId}/state`,
    body: { status: status },
  };
}
