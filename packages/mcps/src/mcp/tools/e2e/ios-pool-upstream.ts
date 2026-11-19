import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  IOS_BUILD_ARCHIVE_CONTENT_TYPE,
  IOS_BUILD_ARCHIVE_EXTENSION,
  IOS_BUILD_ARCHIVE_MAX_BYTES,
  IOS_BUILD_DIGEST_READ_CHUNK_BYTES,
  IOS_BUILD_UPLOAD_TIMEOUT_MS,
} from "../../e2e/contracts/ios-pool-constants.js";
import type { IosBuildUploadInput, IosRunCreateInput } from "../../e2e/contracts/index.js";
import { GatewayError, McpErrorCode } from "../../e2e/types.js";
import type { IUpstreamCall } from "../../e2e/types.js";
import { IOS_POOL_PREFIX } from "./upstream-route-constants.js";

function rejectBuildArchive(appZipPath: string, reason: string): never {
  throw new GatewayError({
    code: McpErrorCode.INVALID_ARGUMENT,
    message: `Build archive ${appZipPath} ${reason}`,
  });
}

/**
 * Hash a file in fixed-size chunks so a build archive of hundreds of megabytes is never held in memory.
 * @param filePath - Resolved path of the file.
 * @returns The lowercase hex sha256 digest.
 */
export function computeFileSha256Hex(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const readBuffer = Buffer.alloc(IOS_BUILD_DIGEST_READ_CHUNK_BYTES);
  const fileDescriptor = fs.openSync(filePath, "r");
  try {
    let bytesRead = fs.readSync(fileDescriptor, readBuffer, 0, readBuffer.length, null);
    while (bytesRead > 0) {
      hash.update(readBuffer.subarray(0, bytesRead));
      bytesRead = fs.readSync(fileDescriptor, readBuffer, 0, readBuffer.length, null);
    }
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return hash.digest("hex");
}

/**
 * Build the upload of a zipped simulator build: the archive streamed from disk as the raw body,
 * its digest, size and provenance in the query string the pool reads them from.
 * @param toolInput - Validated upload input.
 * @returns The upstream POST to the project's artifacts route.
 * @throws GatewayError INVALID_ARGUMENT for a missing, non-zip, empty or oversized archive.
 */
export function buildIosBuildUploadCall(toolInput: IosBuildUploadInput): IUpstreamCall {
  const resolvedPath = path.resolve(toolInput.appZipPath);
  if (path.extname(resolvedPath).toLowerCase() !== IOS_BUILD_ARCHIVE_EXTENSION) {
    rejectBuildArchive(toolInput.appZipPath, `is not a ${IOS_BUILD_ARCHIVE_EXTENSION} file; zip the .app bundle first.`);
  }

  let archiveStats: fs.Stats;
  try {
    archiveStats = fs.statSync(resolvedPath);
  } catch {
    rejectBuildArchive(toolInput.appZipPath, "was not found.");
  }
  if (!archiveStats.isFile()) {
    rejectBuildArchive(toolInput.appZipPath, "is not a file.");
  }
  if (archiveStats.size === 0) {
    rejectBuildArchive(toolInput.appZipPath, "is empty.");
  }
  if (archiveStats.size > IOS_BUILD_ARCHIVE_MAX_BYTES) {
    rejectBuildArchive(toolInput.appZipPath, `is larger than ${IOS_BUILD_ARCHIVE_MAX_BYTES / (1024 * 1024)} MB.`);
  }

  return {
    method: "POST",
    path: `${IOS_POOL_PREFIX}/projects/${encodeURIComponent(toolInput.projectId)}/artifacts`,
    queryParams: {
      digest: computeFileSha256Hex(resolvedPath),
      bundleId: toolInput.bundleId,
      targetRuntime: toolInput.targetRuntime,
      branch: toolInput.branch,
      commit: toolInput.commit,
      sizeBytes: archiveStats.size,
      producer: toolInput.producer,
    },
    fileBody: {
      filePath: resolvedPath,
      contentType: IOS_BUILD_ARCHIVE_CONTENT_TYPE,
      sizeBytes: archiveStats.size,
    },
    timeoutMs: IOS_BUILD_UPLOAD_TIMEOUT_MS,
  };
}

/**
 * Build the run request the pool queues: the run's target and goal, its secret references, and its caps.
 * @param toolInput - Validated run input.
 * @returns The upstream POST to the runs route.
 */
export function buildIosRunCreateCall(toolInput: IosRunCreateInput): IUpstreamCall {
  return {
    method: "POST",
    path: `${IOS_POOL_PREFIX}/runs`,
    body: {
      projectId: toolInput.projectId,
      artifactDigest: toolInput.artifactDigest,
      task: toolInput.task,
      useCaseId: toolInput.useCaseId,
      testCaseId: toolInput.testCaseId,
      deviceType: toolInput.deviceType,
      secretRefs: toolInput.secretRefs,
      caps: {
        maxSteps: toolInput.maxSteps,
        stepTimeoutMs: toolInput.stepTimeoutMs,
        runTimeoutMs: toolInput.runTimeoutMs,
      },
    },
  };
}
