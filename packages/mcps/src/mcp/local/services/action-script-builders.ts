/**
 * Pure builders for the local action-script payload handed to the electron-app
 * studio. Kept free of config/logger/cloud imports so the build logic stays
 * unit-testable in isolation.
 */

import { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import type { PinnedAccount, TestCaseDetails, TestScriptDetails } from "../contracts/project-schemas.js";
import { resolveDisplayParams, resolveReplayDisplayParams } from "./display-resolution.js";
import { rewriteActionScriptUrls } from "./replay-url-rewrite.js";
import type { DisplayResolution } from "../types/enums.js";

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
 *
 * @param params.displayResolution - Resolution for this run; overrides the test
 * case's stored `displayOptions`. Neither given sizes the run at 1920x1080.
 * @param params.freshSession - The run's effective fresh-session value; recorded only when true.
 * @param params.runSettingsId - The local runSettings record the run is recorded against; written only when given.
 */
export function buildGenerationActionScript(params: {
  testCase: TestCaseDetails;
  localUrl: string;
  runId: string;
  localTestScriptId: string;
  ownerUserId: string;
  displayResolution?: DisplayResolution;
  freshSession?: boolean;
  runSettingsId?: string;
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
      // Sizes the studio's webview. Absent, the electron-app falls back to its
      // own hardcoded 1920x1080, which is why a phone-viewport run needs this.
      displayParams: resolveDisplayParams({
        requestedResolution: params.displayResolution,
        storedDisplayOptions: params.testCase.displayOptions,
      }),
      // Replay reads these from the recording, so they are written only when set:
      // a legacy test case must produce exactly the params it always did.
      ...(params.testCase.pinnedAccount ? { pinnedAccount: params.testCase.pinnedAccount } : {}),
      ...(params.freshSession === true ? { freshSession: true } : {}),
      // The studio loads this record's managed profile and secrets, and the cloud files the run
      // under it; without it the cloud picks the local record at displayParams.
      ...(params.runSettingsId ? { runSettingsId: params.runSettingsId } : {}),
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
 * @param params.displayResolution - Resolution for this run. Absent, the run is
 * sized at the test script's recorded `displayParams`, else 1920x1080; present,
 * it must match the recorded size.
 * @param params.pinnedAccount - The account the script was recorded as; when set, the run uses that account's browser session.
 * @param params.freshSession - Whether the script was recorded from an empty session; written only when true.
 * @throws Error when `displayResolution` differs from the script's recorded size.
 */
export function buildReplayActionScript(params: {
  testScript: TestScriptDetails;
  actionScript: unknown[];
  localUrl: string;
  runId: string;
  ownerUserId: string;
  displayResolution?: DisplayResolution;
  pinnedAccount?: PinnedAccount | null;
  freshSession?: boolean;
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
      // Sizes the studio's webview. Absent, the electron-app falls back to its
      // own hardcoded 1920x1080, which is why a phone-viewport run needs this.
      displayParams: resolveReplayDisplayParams({
        requestedResolution: params.displayResolution,
        recordedDisplayParams: params.testScript.displayParams,
      }),
      ...(params.pinnedAccount ? { pinnedAccount: params.pinnedAccount } : {}),
      ...(params.freshSession ? { freshSession: true } : {}),
      // A replay runs under the record of the script it replays. A remote-lane script's record
      // belongs to the other lane, so its replay is filed by size instead.
      ...(params.testScript.type === RunEnvironment.Local && params.testScript.runSettingsId
        ? { runSettingsId: params.testScript.runSettingsId }
        : {}),
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
