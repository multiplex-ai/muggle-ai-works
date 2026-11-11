import { z } from "zod";

import {
  BUG_REPORT_LIST_MAX_PAGE_SIZE,
  BUG_REPORT_MAX_SCREENSHOTS,
  BUG_REPORT_SHORT_ID_PATTERN,
  BUG_REPORT_MESSAGE_MAX_LENGTH,
  BUG_REPORT_TEXT_MAX_LENGTH,
  BUG_REPORT_TITLE_MAX_LENGTH,
  BugReportSeverityEnum,
} from "../../../shared/bug-report/index.js";

const BugReportIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((bugReportId) => !BUG_REPORT_SHORT_ID_PATTERN.test(bugReportId), {
    message: "Pass the bugReportId, not a short id like BUG-4821; find it by shortId with muggle-remote-bug-report-list.",
  })
  .describe("Bug report ID (bugReportId from create or list), not the short id shown to people");

const BugReportTextSchema = z.string().trim().min(1).max(BUG_REPORT_TEXT_MAX_LENGTH);

const BugReportScreenshotPathsSchema = z
  .array(z.string().min(1))
  .max(BUG_REPORT_MAX_SCREENSHOTS)
  .optional()
  .describe(
    `Absolute paths of up to ${BUG_REPORT_MAX_SCREENSHOTS} screenshots on this machine (png, jpg, gif or webp, at most 5 MB each). They are read from disk and uploaded with the report.`,
  );

/** Harness and dashboard context fields; unknown keys are dropped. */
export const BugReportClientContextInputSchema = z
  .object({
    pagePath: z.string().optional(),
    userAgent: z.string().optional(),
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
    uiRelease: z.string().optional(),
    cliVersion: z.string().optional(),
    studioVersion: z.string().optional(),
    os: z.string().optional(),
    lastProjectId: z.string().optional(),
    lastLocalRunId: z.string().optional(),
    lastLocalRunStatus: z.string().optional(),
  })
  .describe("Context captured where the bug was hit; pass data.clientContext from muggle-local-bug-report-context-get");

/** Input for muggle-remote-bug-report-create. */
export const BugReportCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(BUG_REPORT_TITLE_MAX_LENGTH).describe("One-line summary of the bug"),
  description: BugReportTextSchema.describe("What happened, in the user's words"),
  severity: z
    .nativeEnum(BugReportSeverityEnum)
    .describe("The user's call: blocker (cannot continue), major (works around it with effort), minor (cosmetic or small)"),
  stepsToReproduce: BugReportTextSchema.optional().describe("Steps that make the bug happen"),
  expectedBehavior: BugReportTextSchema.optional().describe("What the user expected"),
  actualBehavior: BugReportTextSchema.optional().describe("What happened instead"),
  screenshotPaths: BugReportScreenshotPathsSchema,
  clientContext: BugReportClientContextInputSchema.optional(),
});

/** Input for muggle-remote-bug-report-list. */
export const BugReportListInputSchema = z.object({
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(BUG_REPORT_LIST_MAX_PAGE_SIZE)
    .optional()
    .describe(`Reports per page, at most ${BUG_REPORT_LIST_MAX_PAGE_SIZE}`),
  cursor: z.string().min(1).optional().describe("nextCursor from the previous page"),
});

/** Input for muggle-remote-bug-report-get. */
export const BugReportGetInputSchema = z.object({
  bugReportId: BugReportIdSchema,
});

/** Input for muggle-remote-bug-report-reply. */
export const BugReportReplyInputSchema = z.object({
  bugReportId: BugReportIdSchema,
  message: z.string().trim().min(1).max(BUG_REPORT_MESSAGE_MAX_LENGTH).describe("The user's reply on the ticket"),
  screenshotPaths: BugReportScreenshotPathsSchema,
});

export type BugReportCreateInput = z.infer<typeof BugReportCreateInputSchema>;
export type BugReportReplyInput = z.infer<typeof BugReportReplyInputSchema>;
