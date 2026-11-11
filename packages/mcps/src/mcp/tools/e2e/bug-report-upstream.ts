import * as fs from "node:fs";
import * as path from "node:path";

import {
  BUG_REPORT_MAX_SCREENSHOT_BYTES,
  BUG_REPORT_MAX_SCREENSHOTS,
  BUG_REPORT_PAYLOAD_FIELD,
  BUG_REPORT_REPLY_MESSAGE_FIELD,
  BUG_REPORT_SCREENSHOT_CONTENT_TYPES,
  BUG_REPORT_SCREENSHOTS_FIELD,
  BUG_REPORTS_PATH,
  BugReportSourceEnum,
  sanitizeBugReportClientContext,
} from "../../../shared/bug-report/index.js";
import type { BugReportCreateInput, BugReportReplyInput } from "../../e2e/contracts/index.js";
import { GatewayError, McpErrorCode } from "../../e2e/types.js";
import type { IUpstreamCall, IUpstreamMultipartFile } from "../../e2e/types.js";

function rejectScreenshot(screenshotPath: string, reason: string): never {
  throw new GatewayError({
    code: McpErrorCode.INVALID_ARGUMENT,
    message: `Screenshot ${screenshotPath} ${reason}`,
  });
}

/**
 * Read screenshots from disk as multipart file parts, refusing anything that is not an image file
 * within the size limit.
 * @param screenshotPaths - Paths on this machine; relative paths resolve against the server's cwd.
 * @returns One file part per screenshot, in the order given.
 * @throws GatewayError INVALID_ARGUMENT for too many files, a missing file, a non-image extension, or an empty or oversized file.
 */
export function readBugReportScreenshotFiles(screenshotPaths: string[]): IUpstreamMultipartFile[] {
  if (screenshotPaths.length > BUG_REPORT_MAX_SCREENSHOTS) {
    throw new GatewayError({
      code: McpErrorCode.INVALID_ARGUMENT,
      message: `At most ${BUG_REPORT_MAX_SCREENSHOTS} screenshots may be attached; got ${screenshotPaths.length}.`,
    });
  }

  return screenshotPaths.map((screenshotPath) => {
    const resolvedPath = path.resolve(screenshotPath);
    const contentType = BUG_REPORT_SCREENSHOT_CONTENT_TYPES[path.extname(resolvedPath).toLowerCase()];
    if (!contentType) {
      rejectScreenshot(screenshotPath, `is not an image; attach ${Object.keys(BUG_REPORT_SCREENSHOT_CONTENT_TYPES).join(", ")} files only.`);
    }

    let screenshotStats: fs.Stats;
    try {
      screenshotStats = fs.statSync(resolvedPath);
    } catch {
      rejectScreenshot(screenshotPath, "was not found.");
    }
    if (!screenshotStats.isFile()) {
      rejectScreenshot(screenshotPath, "is not a file.");
    }
    if (screenshotStats.size === 0) {
      rejectScreenshot(screenshotPath, "is empty.");
    }
    if (screenshotStats.size > BUG_REPORT_MAX_SCREENSHOT_BYTES) {
      rejectScreenshot(screenshotPath, `is larger than ${BUG_REPORT_MAX_SCREENSHOT_BYTES / (1024 * 1024)} MB.`);
    }

    return {
      fieldName: BUG_REPORT_SCREENSHOTS_FIELD,
      fileName: path.basename(resolvedPath),
      contentType: contentType,
      fileBase64: fs.readFileSync(resolvedPath).toString("base64"),
    };
  });
}

/**
 * Build the multipart call that files a bug report from the harness: the report as a JSON `payload`
 * field with secret-looking context removed, then each screenshot read from disk.
 * @param toolInput - Validated create input.
 * @returns The upstream POST to the bug reports route.
 */
export function buildBugReportCreateCall(toolInput: BugReportCreateInput): IUpstreamCall {
  const reportPayload = {
    title: toolInput.title,
    description: toolInput.description,
    severity: toolInput.severity,
    stepsToReproduce: toolInput.stepsToReproduce,
    expectedBehavior: toolInput.expectedBehavior,
    actualBehavior: toolInput.actualBehavior,
    source: BugReportSourceEnum.Harness,
    clientContext: sanitizeBugReportClientContext(toolInput.clientContext).clientContext,
  };
  return {
    method: "POST",
    path: BUG_REPORTS_PATH,
    multipartFormData: {
      textFields: { [BUG_REPORT_PAYLOAD_FIELD]: JSON.stringify(reportPayload) },
      files: readBugReportScreenshotFiles(toolInput.screenshotPaths ?? []),
    },
  };
}

/**
 * Build the multipart call that posts the filer's reply on a ticket.
 * @param toolInput - Validated reply input.
 * @returns The upstream POST to the ticket's replies route.
 */
export function buildBugReportReplyCall(toolInput: BugReportReplyInput): IUpstreamCall {
  return {
    method: "POST",
    path: `${BUG_REPORTS_PATH}/${encodeURIComponent(toolInput.bugReportId)}/replies`,
    multipartFormData: {
      textFields: { [BUG_REPORT_REPLY_MESSAGE_FIELD]: toolInput.message },
      files: readBugReportScreenshotFiles(toolInput.screenshotPaths ?? []),
    },
  };
}
