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

/**
 * Public image-proxy prefix used to wrap resolved Firebase Storage URLs so
 * GitHub's image proxy (Camo) sees a declared `Content-Type: image/jpeg`.
 *
 * Firebase download URLs serve whatever Content-Type is stored in the GCS
 * object metadata — and the Muggle action-script uploader stores screenshots
 * with `Content-Type: application/octet-stream`. Camo refuses to embed
 * anything that isn't declared `image/*`, so the images render as broken
 * icons in PR comments unless we route them through a proxy that re-serves
 * the bytes with the correct header.
 *
 * `images.weserv.nl` is a free, widely-used public image proxy that reads the
 * bytes and forwards them with the right `Content-Type` (and caches by URL).
 * We keep the prefix as a constant so it's trivial to swap for a Muggle-owned
 * proxy later, and so the root cause — fix the Content-Type at upload time in
 * muggle-ai-teaching-service / the Electron app — is easy to link back to.
 */
export const IMAGE_PROXY_PREFIX = "https://images.weserv.nl/?url=";
