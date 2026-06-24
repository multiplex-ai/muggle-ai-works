/**
 * Pure builders for the local action-script payload handed to the electron-app
 * studio. Kept free of config/logger/cloud imports so the build logic stays
 * unit-testable in isolation.
 */

import type { TestCaseDetails, TestScriptDetails } from "../contracts/project-schemas.js";
import { rewriteActionScriptUrls } from "./replay-url-rewrite.js";

/**
 * Get a required string from an object field.
 */
function getRequiredStringField(params: {
  source: Record<string, unknown>;
  fieldName: string;
  sourceLabel: string;
}): string {
  const value = params.source[params.fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Missing required field '${params.fieldName}' in ${params.sourceLabel}. ` +
        "Please pass the full object from the corresponding muggle-remote-* get tool.",
    );
  }
  return value;
}

/**
 * Build a local action script for test generation (explore mode).
 */
export function buildGenerationActionScript(params: {
  testCase: TestCaseDetails;
  localUrl: string;
  runId: string;
  localTestScriptId: string;
  ownerUserId: string;
}): Record<string, unknown> {
  const testCaseRecord = params.testCase as unknown as Record<string, unknown>;
  const projectId = getRequiredStringField({
    source: testCaseRecord,
    fieldName: "projectId",
    sourceLabel: "testCase",
  });
  const useCaseId = getRequiredStringField({
    source: testCaseRecord,
    fieldName: "useCaseId",
    sourceLabel: "testCase",
  });

  return {
    actionScriptId: params.localTestScriptId,
    actionScriptName: `Local Generation ${params.testCase.title}`,
    actionType: "UserDefined",
    actionParams: {
      type: "Test Script Generation Workflow",
      name: `Local Generation ${params.testCase.title}`,
      ownerId: params.ownerUserId,
      projectId: projectId,
      useCaseId: useCaseId,
      testCaseId: params.testCase.id,
      testScriptId: params.localTestScriptId,
      actionScriptId: params.localTestScriptId,
      workflowRunId: params.runId,
      url: params.localUrl,
      // The studio executes against `url` (localhost) but uploads `productionUrl`
      // as the run's remoteUrl. Without it the studio falls back to the localhost
      // url, so the run record shows localhost where the test case's cloud url belongs.
      productionUrl: params.testCase.url,
      // Tags the run as locally executed so the studio skips its own cloud
      // ActionScript/TestScript write — the /local-run/upload path is the
      // single writer for local runs (avoids duplicate Firestore docs).
      executionSource: "local",
      // Resolved server-side (a UUID get-or-created per project, 1-1 with
      // projectId but NOT equal to it). The MCP has no client-side source for
      // it, so leave it empty here; STM-on-local needs a backend resolver.
      sharedTestMemoryId: "",
      runEnvironmentType: "local",
    },
    goal: params.testCase.goal,
    url: params.localUrl,
    description: params.testCase.title,
    precondition: params.testCase.precondition ?? "",
    instructions: params.testCase.instructions ?? "",
    expectedResult: params.testCase.expectedResult,
    steps: [],
    ownerId: params.ownerUserId,
    createdAt: Date.now(),
    isRemoteScript: false,
    status: "active",
  };
}

/**
 * Build a local action script for test replay (engine mode).
 * @param params.testScript - Test script metadata (from muggle-remote-test-script-get).
 * @param params.actionScript - Action script steps (from muggle-remote-action-script-get).
 * @param params.localUrl - Local URL to test against.
 * @param params.runId - Run ID for this execution.
 * @param params.ownerUserId - Owner user ID.
 */
export function buildReplayActionScript(params: {
  testScript: TestScriptDetails;
  actionScript: unknown[];
  localUrl: string;
  runId: string;
  ownerUserId: string;
}): Record<string, unknown> {
  const testScriptRecord = params.testScript as unknown as Record<string, unknown>;
  const projectId = getRequiredStringField({
    source: testScriptRecord,
    fieldName: "projectId",
    sourceLabel: "testScript",
  });
  const useCaseId = getRequiredStringField({
    source: testScriptRecord,
    fieldName: "useCaseId",
    sourceLabel: "testScript",
  });

  const rewrittenActionScript = rewriteActionScriptUrls({
    actionScript: params.actionScript,
    originalUrl: params.testScript.url,
    localUrl: params.localUrl,
  });

  return {
    actionScriptId: params.testScript.actionScriptId,
    actionScriptName: params.testScript.name,
    actionType: "UserDefined",
    actionParams: {
      type: "Test Script Replay Workflow",
      name: params.testScript.name,
      ownerId: params.ownerUserId,
      projectId: projectId,
      useCaseId: useCaseId,
      testCaseId: params.testScript.testCaseId,
      testScriptId: params.testScript.id,
      workflowRunId: params.runId,
      // The studio executes against the rewritten localhost steps but uploads
      // `productionUrl` as the run's remoteUrl. Without it the studio falls back
      // to the localhost url, so the run record shows localhost where the test
      // script's cloud url belongs.
      productionUrl: params.testScript.url,
      // Tags the run as locally executed so the studio skips its own cloud
      // ActionScript write — replay's cloud record is owned by the upload path
      // (avoids duplicate Firestore docs).
      executionSource: "local",
      // Resolved server-side (a UUID get-or-created per project, 1-1 with
      // projectId but NOT equal to it). The MCP has no client-side source for
      // it, so leave it empty here; STM-on-local needs a backend resolver.
      sharedTestMemoryId: "",
      runEnvironmentType: "local",
    },
    goal: params.testScript.name,
    url: params.localUrl,
    description: params.testScript.name,
    precondition: "",
    expectedResult: "Replay completes without critical failures.",
    steps: rewrittenActionScript,
    ownerId: params.ownerUserId,
    createdAt: Date.now(),
    isRemoteScript: true,
    status: "active",
  };
}
