import { localQa } from "@muggleai/mcp";

import { COPIED_TEST_CASE_FIELDS } from "./local-generate-constants.js";
import type { IRemoteTestCaseRecord } from "./local-generate-types.js";

/**
 * Turn a `muggle-remote-test-case-get` record into the test case the generation tool takes.
 *
 * Null fields are dropped because the tool's schema reads an absent optional field as "not set";
 * `pinnedAccount: null` is kept, since the schema reads it as "explicitly unpinned".
 *
 * @param params.remoteTestCase - The fetched test case.
 * @param params.expectedProjectId - Project the caller named; the test case must belong to it.
 * @returns The validated test case.
 * @throws Error when the test case belongs to another project, has no URL, or misses a required field.
 */
export function toGenerationTestCase(params: {
  remoteTestCase: IRemoteTestCaseRecord;
  expectedProjectId: string;
}): localQa.TestCaseDetails {
  const { remoteTestCase } = params;
  if (remoteTestCase.projectId !== params.expectedProjectId) {
    throw new Error(
      `Test case ${String(remoteTestCase.id)} belongs to project ${String(remoteTestCase.projectId)}, not ${params.expectedProjectId}.`,
    );
  }
  if (typeof remoteTestCase.url !== "string" || remoteTestCase.url.trim() === "") {
    throw new Error(`Test case ${String(remoteTestCase.id)} has no URL to generate against.`);
  }

  const copiedFields: Record<string, unknown> = {};
  for (const fieldName of COPIED_TEST_CASE_FIELDS) {
    const fieldValue = remoteTestCase[fieldName];
    const isKeptNull = fieldName === "pinnedAccount" && fieldValue === null;
    if (fieldValue !== undefined && (fieldValue !== null || isKeptNull)) {
      copiedFields[fieldName] = fieldValue;
    }
  }
  return localQa.TestCaseDetailsSchema.parse(copiedFields);
}
