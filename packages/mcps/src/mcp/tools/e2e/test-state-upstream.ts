/**
 * Upstream paths and request-body fields of the test state coverage tools.
 */

import type { z } from "zod";

import type { TestCaseTestStateFieldsSchema } from "../../e2e/contracts/index.js";
import { MUGGLE_TEST_PREFIX } from "./upstream-route-constants.js";

/**
 * Builds the path of a project's test state catalog.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/test-state-catalog`.
 */
export function buildTestStateCatalogPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/test-state-catalog`;
}

/**
 * Builds the path of a project's test state collection.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/test-states`.
 */
export function buildTestStatesPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/test-states`;
}

/**
 * Builds the path of a project's test role collection.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/test-roles`.
 */
export function buildTestRolesPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/test-roles`;
}

/**
 * Builds the path of a project's test state coverage plan preview.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/test-state-plan`.
 */
export function buildTestStatePlanPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/test-state-plan`;
}

/**
 * Picks the test state fields a test case create or update sends: an explicit null stays (it clears the field), an
 * omitted field stays off the body.
 * @param testStateFields - The tool input, read for its test state fields only.
 * @returns e.g. `{ prerequisiteStateId: "<uuid>", resultStateId: null }`.
 */
export function pickTestCaseTestStateFields(
  testStateFields: z.infer<typeof TestCaseTestStateFieldsSchema>,
): Partial<z.infer<typeof TestCaseTestStateFieldsSchema>> {
  const requestFields: Partial<z.infer<typeof TestCaseTestStateFieldsSchema>> = {};
  if (testStateFields.actsAsRoleIds !== undefined) requestFields.actsAsRoleIds = testStateFields.actsAsRoleIds;
  if (testStateFields.prerequisiteStateId !== undefined) {
    requestFields.prerequisiteStateId = testStateFields.prerequisiteStateId;
  }
  if (testStateFields.resultStateId !== undefined) requestFields.resultStateId = testStateFields.resultStateId;
  return requestFields;
}
