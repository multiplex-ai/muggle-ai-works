/**
 * Zod schemas for local execution tools.
 *
 * These schemas support the minimal local tool set:
 * - Execution (test generation, replay, cancel)
 * - Run results (list, get)
 * - Test scripts (list, get)
 * - Publishing
 *
 * Design principle: Execution tools accept full test case/script details
 * (fetched via muggle-remote-* tools), not just IDs. This keeps local tools free of
 * cloud dependencies.
 */

import { z } from "zod";

import { DisplayParamsSchema } from "../../contracts/display-params-schema.js";
import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { PinnedAccountSchema } from "../../contracts/pinned-account-schema.js";
import { RunEnvironmentSchema } from "../../e2e/contracts/run-environment.js";
import { DisplayResolution } from "../types/enums.js";

/** Resolution a run executes at, accepted wherever a caller may name one. */
export const DisplayResolutionSchema = z.nativeEnum(DisplayResolution);

/**
 * Test case details schema.
 * These fields come from muggle-remote-test-case-get response.
 */
export const TestCaseDetailsSchema = z.object({
  /** Cloud test case ID. */
  id: MuggleEntityIdSchema.describe("Cloud test case ID (UUID)"),
  /** Test case title. */
  title: z.string().min(1).describe("Test case title"),
  /** Test goal. */
  goal: z.string().min(1).describe("Test goal - what the test should verify"),
  /** Expected result. */
  expectedResult: z.string().min(1).describe("Expected outcome after test execution"),
  /** Preconditions (optional). */
  precondition: z.string().optional().describe("Initial state/setup required before test execution"),
  /** Step-by-step instructions (optional). */
  instructions: z.string().optional().describe("Step-by-step instructions for the test"),
  /** Original cloud URL (for reference, replaced by localUrl). */
  url: z.string().url().optional().describe("Original cloud URL (replaced by localUrl during execution)"),
  /** Cloud project ID (required for electron workflow context). */
  projectId: MuggleEntityIdSchema.describe("Cloud project ID (UUID)"),
  /** Cloud use case ID (required for electron workflow context). */
  useCaseId: MuggleEntityIdSchema.describe("Cloud use case ID (UUID)"),
  /** Resolutions stored on the cloud test case; the first entry sizes the run unless the caller names one. */
  displayOptions: z
    .array(DisplayResolutionSchema)
    .optional()
    .describe(
      "Resolutions stored on the cloud test case (from muggle-remote-test-case-get). The first entry sizes the browser unless displayResolution overrides it.",
    ),
  /** Project secrets the test case signs in as; absent or null means unpinned. */
  pinnedAccount: PinnedAccountSchema.nullable().optional().describe("Pinned account from muggle-remote-test-case-get; the run signs in only as this pair"),
  /** Whether every run starts from an empty browser session. */
  alwaysStartsFreshSession: z.boolean().optional().describe("Stored fresh-session flag from muggle-remote-test-case-get; used when freshSession is not passed"),
});

export type TestCaseDetails = z.infer<typeof TestCaseDetailsSchema>;

export type PinnedAccount = z.infer<typeof PinnedAccountSchema>;

/**
 * Test script details schema.
 * These fields come from muggle-remote-test-script-get response.
 * Note: actionScript content is fetched separately via muggle-remote-action-script-get.
 */
export const TestScriptDetailsSchema = z.object({
  /** Cloud test script ID. */
  id: MuggleEntityIdSchema.describe("Cloud test script ID (UUID)"),
  /** Script name. */
  name: z.string().min(1).describe("Test script name"),
  /** Cloud test case ID this script belongs to. */
  testCaseId: MuggleEntityIdSchema.describe("Cloud test case ID (UUID) this script was generated from"),
  /** Action script ID reference (use muggle-remote-action-script-get to fetch content). */
  actionScriptId: MuggleEntityIdSchema.describe(
    "Action script ID (UUID) — use muggle-remote-action-script-get to fetch the full script",
  ),
  /** Original cloud URL (for reference, replaced by localUrl). */
  url: z.string().url().optional().describe("Original cloud URL (replaced by localUrl during execution)"),
  /** Cloud project ID (required for electron workflow context). */
  projectId: MuggleEntityIdSchema.describe("Cloud project ID (UUID)"),
  /** Cloud use case ID (required for electron workflow context). */
  useCaseId: MuggleEntityIdSchema.describe("Cloud use case ID (UUID)"),
  /** The runSettings record the script was recorded under; a local-lane script's replay is recorded against it. */
  runSettingsId: z.string().optional(),
  /** The window size the script was recorded at; sizes the replay unless the caller names a resolution. */
  displayParams: DisplayParamsSchema.optional(),
  /** The lane the script belongs to; only a local-lane script's record names the replay's. */
  type: RunEnvironmentSchema.optional(),
});

export type TestScriptDetails = z.infer<typeof TestScriptDetailsSchema>;

/**
 * Execute test generation input schema.
 * Accepts full test case details (from muggle-remote-test-case-get) plus local URL.
 */
export const ExecuteTestGenerationInputSchema = z.object({
  /** Test case details from muggle-remote-test-case-get. */
  testCase: TestCaseDetailsSchema.describe("Test case details obtained from muggle-remote-test-case-get"),
  /** Local URL to test against. */
  localUrl: z.string().url().describe("Local URL to test against (e.g., http://localhost:3000)"),
  /** Absolute path identifying the caller's worktree. Drives the cross-worktree single-flight lock — same path = parallel allowed (intra-change), different path = waits its turn. Required: ambiguity here causes the lock to mis-key, splitting one logical change into two competing holders. */
  cwd: z.string().min(1).describe("Absolute path of the caller's worktree. Required — this keys the cross-worktree single-flight lock so concurrent muggle-test runs from different branches serialize."),
  /** Optional timeout. */
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds (default: 300000 = 5 min)"),
  /** Show the electron-app UI during execution. Default: visible window. Pass false to run headless. */
  showUi: z.boolean().optional().describe("Show the electron-app UI during generation. Defaults to visible; pass false to run headless."),
  /** Clear all session storage (cookies, localStorage, etc.) before execution. Use for test cases that require a clean browser state, such as registration, login, or cookie consent flows. */
  freshSession: z.boolean().optional().describe("Clear all session storage (cookies, localStorage, etc.) before execution. Use for test cases that require a clean browser state — e.g. registration, login, or cookie consent flows. Default: the test case's stored alwaysStartsFreshSession flag (false when unset)."),
  /** Mutation parameters providing variable context for this generation run — a string[] where each element is a plain-English instruction or a local file path for uploads (e.g. "Attach the image at C:\\Users\\user\\photo.jpg"). Matches the electron-app's string[] mutation file format. */
  mutations: z.array(z.string()).optional().describe("Mutation parameters: string[] where each element is a plain-English instruction or a local file path (e.g. [\"The post content should be 'Hello'\", \"Attach the image at C:\\\\Users\\\\user\\\\photo.jpg\"])."),
  /** Resolution for this run. Overrides `testCase.displayOptions`; both absent means 1920x1080. */
  displayResolution: DisplayResolutionSchema.optional().describe(
    "Browser resolution for this run, e.g. R_0390x0844 for a 390x844 phone viewport. Overrides testCase.displayOptions; defaults to R_1920x1080 when neither is given.",
  ),
  /** The local-lane runSettings record to generate the script for. */
  runSettingsId: z.string().optional().describe(
    "Local runSettings record to record this run against, e.g. a local script's runSettingsId. Pass its resolution as displayResolution.",
  ),
});

export type ExecuteTestGenerationInput = z.infer<typeof ExecuteTestGenerationInputSchema>;

/**
 * Execute replay input schema.
 * Accepts test script metadata and actionScript content (fetched separately).
 */
export const ExecuteReplayInputSchema = z.object({
  /** Test script metadata from muggle-remote-test-script-get. */
  testScript: TestScriptDetailsSchema.describe("Test script metadata from muggle-remote-test-script-get"),
  /** Action script content from muggle-remote-action-script-get (using testScript.actionScriptId). */
  actionScript: z.array(z.unknown()).describe("Action script steps from muggle-remote-action-script-get"),
  /** Local URL to test against. */
  localUrl: z.string().url().describe("Local URL to test against (e.g., http://localhost:3000)"),
  /** Absolute path identifying the caller's worktree. Drives the cross-worktree single-flight lock — same path = parallel allowed (intra-change), different path = waits its turn. Required: ambiguity here causes the lock to mis-key, splitting one logical change into two competing holders. */
  cwd: z.string().min(1).describe("Absolute path of the caller's worktree. Required — this keys the cross-worktree single-flight lock so concurrent muggle-test runs from different branches serialize."),
  /** Optional timeout. */
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds (default: 180000 = 3 min)"),
  /** Show the electron-app UI during execution. Default: visible window. Pass false to run headless. */
  showUi: z.boolean().optional().describe("Show the electron-app UI during replay. Defaults to visible; pass false to run headless."),
  /** Whether the replay starts from an emptied browser session, copied from the recording. */
  freshSession: z.boolean().optional().describe("Copy from actionParams.freshSession of the muggle-remote-action-script-get result, so the replay starts the way the script was recorded: true clears all session storage (cookies, localStorage, etc.) before execution. A recording without it may predate run identities; pass true then only for a test that needs clean browser state (registration, login, cookie consent). Default: false."),
  /** Mutation parameters passed to the LLM step predictor — a string[] where each element is an instruction describing what varies this run. Supports plain-English instructions (e.g. "The post content should be 'Hello world'") and local file paths for uploads (e.g. "Attach the image at C:\\Users\\user\\photo.jpg"). Matches the electron-app's string[] mutation file format. When provided, the electron app uses LLM-driven step prediction instead of deterministic replay. */
  mutations: z.array(z.string()).optional().describe("Mutation parameters: string[] where each element is a plain-English instruction or a local file path (e.g. [\"The post content should be 'Hello'\", \"Attach the image at C:\\\\Users\\\\user\\\\photo.jpg\"])."),
  /** Pinned account the script was recorded with, copied from the recording. */
  pinnedAccount: PinnedAccountSchema.nullable().optional().describe("Copy from actionParams.pinnedAccount of the muggle-remote-action-script-get result: the account the script was recorded as, not the test case's current pin. A pinned replay runs in that account's own browser session; omit when the recording carries none."),
  /** Resolution for this run; defaults to the size the script was recorded at. */
  displayResolution: DisplayResolutionSchema.optional().describe(
    "Browser resolution, e.g. R_0390x0844. Defaults to the script's recorded size.",
  ),
});

export type ExecuteReplayInput = z.infer<typeof ExecuteReplayInputSchema>;

/**
 * Cancel execution input schema.
 */
export const CancelExecutionInputSchema = z.object({
  runId: MuggleEntityIdSchema.describe("Run ID (UUID) to cancel"),
});

export type CancelExecutionInput = z.infer<typeof CancelExecutionInputSchema>;


/**
 * Run result list input schema.
 */
export const RunResultListInputSchema = z.object({
  cloudTestCaseId: MuggleEntityIdSchema.optional().describe("Optional cloud test case ID (UUID) to filter by"),
  limit: z.number().int().positive().optional().describe("Maximum results to return (default: 20)"),
});

export type RunResultListInput = z.infer<typeof RunResultListInputSchema>;

/**
 * Run result get input schema.
 */
export const RunResultGetInputSchema = z.object({
  runId: MuggleEntityIdSchema.describe("Run result ID (UUID) to retrieve"),
});

export type RunResultGetInput = z.infer<typeof RunResultGetInputSchema>;

/**
 * Run steps get input schema.
 *
 * The id is a free-form string rather than a UUID: the newest run is the common case and takes no
 * id at all, and a person reading a terminal supplies a prefix rather than retyping a UUID.
 */
export const RunStepsGetInputSchema = z.object({
  runId: z
    .string()
    .min(1)
    .optional()
    .describe("Run id, or a unique prefix of one. Omit to read the most recent run."),
});

export type RunStepsGetInput = z.infer<typeof RunStepsGetInputSchema>;


/**
 * Test script list input schema.
 */
export const TestScriptListInputSchema = z.object({
  cloudTestCaseId: MuggleEntityIdSchema.optional().describe("Optional cloud test case ID (UUID) to filter by"),
});

export type TestScriptListInput = z.infer<typeof TestScriptListInputSchema>;

/**
 * Test script get input schema.
 */
export const TestScriptGetInputSchema = z.object({
  testScriptId: MuggleEntityIdSchema.describe("Local stored test script ID (UUID) to retrieve"),
});

export type TestScriptGetInput = z.infer<typeof TestScriptGetInputSchema>;
