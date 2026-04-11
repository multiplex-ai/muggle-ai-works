/**
 * Types and constants for `resolve-urls.ts`.
 *
 * Kept separate from the business logic so that the service module only
 * imports pure declarations, in line with the repo-wide preference for
 * separating types/constants from the functions that use them.
 */

/** Options bag for {@link resolveGsScreenshotUrls}. */
export interface IResolveUrlsOptions {
  /** Sink for all user-facing diagnostics. The resolver never writes stdout. */
  stderrWrite: (s: string) => void;
}

/** Shape of a successful response from `/v1/protected/storage/publicUrl`. */
export interface IPublicUrlResponse {
  resourceUrl?: unknown;
}

/** URI scheme that identifies a Google Cloud Storage path. */
export const GS_SCHEME = "gs://";

/** Sub-path on the prompt service that converts a gs:// URI to HTTPS. */
export const PUBLIC_URL_PATH = "/v1/protected/storage/publicUrl";

/** HTTP timeout (ms) for a single publicUrl resolution call. */
export const RESOLVE_TIMEOUT_MS = 10_000;

/** Log prefix used for every stderr line written by the resolver. */
export const LOG_PREFIX = "build-pr-section";
