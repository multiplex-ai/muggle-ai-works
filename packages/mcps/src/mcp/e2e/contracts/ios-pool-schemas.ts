import { z } from "zod";

import {
  DEFAULT_IOS_RUN_MAX_STEPS,
  DEFAULT_IOS_RUN_STEP_TIMEOUT_MS,
  DEFAULT_IOS_RUN_TIMEOUT_MS,
  IOS_BUILD_ARCHIVE_EXTENSION,
  IOS_BUILD_ARCHIVE_MAX_BYTES,
  IOS_RUN_MAX_STEPS_LIMIT,
  IOS_RUN_STEP_TIMEOUT_LIMIT_MS,
  IOS_RUN_TIMEOUT_LIMIT_MS,
} from "./ios-pool-constants.js";
import { IosArtifactProducerEnum } from "./ios-pool-types.js";

const IosProjectIdSchema = z.string().min(1).describe("Muggle project ID (UUID) the iOS build or run belongs to");

const IosBuildDigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "must be the lowercase hex sha256 digest muggle-remote-ios-build-upload returned")
  .describe("sha256 digest of an uploaded build (artifact.digest from muggle-remote-ios-build-upload or -list)");

/** Input for muggle-remote-ios-build-upload. */
export const IosBuildUploadInputSchema = z.object({
  projectId: IosProjectIdSchema,
  appZipPath: z
    .string()
    .min(1)
    .describe(
      `Absolute path on this machine of the zipped .app simulator build (${IOS_BUILD_ARCHIVE_EXTENSION}, at most ${IOS_BUILD_ARCHIVE_MAX_BYTES / (1024 * 1024)} MB). Streamed from disk; never read it yourself.`,
    ),
  bundleId: z.string().min(1).describe("The app's bundle identifier, e.g. com.example.app"),
  targetRuntime: z.string().min(1).describe("Simulator runtime the build targets, e.g. iOS-17-5"),
  branch: z.string().min(1).describe("Git branch the build was made from"),
  commit: z.string().min(1).describe("Git commit SHA the build was made from"),
  producer: z
    .nativeEnum(IosArtifactProducerEnum)
    .default(IosArtifactProducerEnum.CiPush)
    .describe("Who is uploading: ci_push for an automated pipeline or agent (default); dashboard_upload only for a person's manual upload"),
});

/** Input for muggle-remote-ios-build-list. */
export const IosBuildListInputSchema = z.object({
  projectId: IosProjectIdSchema,
});

/** Input for muggle-remote-ios-run-create. */
export const IosRunCreateInputSchema = z
  .object({
    projectId: IosProjectIdSchema,
    artifactDigest: IosBuildDigestSchema,
    task: z.string().min(1).optional().describe("Plain-language goal for the agent to verify in the app"),
    useCaseId: z.string().min(1).optional().describe("Existing use case to run instead of a free-form task"),
    testCaseId: z.string().min(1).optional().describe("Existing test case to run instead of a free-form task"),
    deviceType: z.string().min(1).describe("Simulator device type to run on, e.g. iPhone-15"),
    secretRefs: z
      .array(z.string().min(1))
      .default([])
      .describe("Names of project secrets the host resolves at claim time, such as a login password; never the secret values"),
    maxSteps: z
      .number()
      .int()
      .positive()
      .max(IOS_RUN_MAX_STEPS_LIMIT)
      .default(DEFAULT_IOS_RUN_MAX_STEPS)
      .describe("Most agent steps before the run stops with a machinery status"),
    stepTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(IOS_RUN_STEP_TIMEOUT_LIMIT_MS)
      .default(DEFAULT_IOS_RUN_STEP_TIMEOUT_MS)
      .describe("Per-step timeout in milliseconds"),
    runTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(IOS_RUN_TIMEOUT_LIMIT_MS)
      .default(DEFAULT_IOS_RUN_TIMEOUT_MS)
      .describe("Whole-run timeout in milliseconds"),
  })
  .refine((runInput) => Boolean(runInput.task || runInput.useCaseId || runInput.testCaseId), {
    message: "Pass one of task, useCaseId, or testCaseId.",
  });

/** Input for muggle-remote-ios-run-get and muggle-remote-ios-run-steps-get. */
export const IosRunReadInputSchema = z.object({
  runId: z.string().min(1).describe("iOS run ID (run.runId from muggle-remote-ios-run-create)"),
});

export type IosBuildUploadInput = z.infer<typeof IosBuildUploadInputSchema>;
export type IosBuildListInput = z.infer<typeof IosBuildListInputSchema>;
export type IosRunCreateInput = z.infer<typeof IosRunCreateInputSchema>;
export type IosRunReadInput = z.infer<typeof IosRunReadInputSchema>;
