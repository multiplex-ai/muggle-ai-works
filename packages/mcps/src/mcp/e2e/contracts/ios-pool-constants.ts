import { IosRunStatusEnum } from "./ios-pool-types.js";

/** Machinery statuses a run never leaves; polling a run can stop at any of them. */
export const FINISHED_IOS_RUN_STATUSES: readonly IosRunStatusEnum[] = [
  IosRunStatusEnum.Completed,
  IosRunStatusEnum.InfraError,
  IosRunStatusEnum.TimedOut,
  IosRunStatusEnum.Cancelled,
];

/** Largest build archive the iOS pool accepts: 512 MiB. */
export const IOS_BUILD_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;

/** File extension of a zipped `.app` simulator build. */
export const IOS_BUILD_ARCHIVE_EXTENSION = ".zip";

/** Content type the pool requires on a build upload body. */
export const IOS_BUILD_ARCHIVE_CONTENT_TYPE = "application/octet-stream";

/** Bytes read per chunk while hashing a build archive: 1 MiB. */
export const IOS_BUILD_DIGEST_READ_CHUNK_BYTES = 1024 * 1024;

/** Timeout of one build upload, long enough to stream the largest archive: 10 minutes. */
export const IOS_BUILD_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** Agent steps an iOS run may take when the caller sets no cap. */
export const DEFAULT_IOS_RUN_MAX_STEPS = 60;

/** Per-step timeout of an iOS run when the caller sets none: 2 minutes. */
export const DEFAULT_IOS_RUN_STEP_TIMEOUT_MS = 2 * 60 * 1000;

/** Whole-run timeout of an iOS run when the caller sets none: 30 minutes. */
export const DEFAULT_IOS_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** Most agent steps the pool accepts for one run. */
export const IOS_RUN_MAX_STEPS_LIMIT = 500;

/** Longest per-step timeout the pool accepts: 10 minutes. */
export const IOS_RUN_STEP_TIMEOUT_LIMIT_MS = 10 * 60 * 1000;

/** Longest whole-run timeout the pool accepts: 2 hours. */
export const IOS_RUN_TIMEOUT_LIMIT_MS = 2 * 3600 * 1000;
