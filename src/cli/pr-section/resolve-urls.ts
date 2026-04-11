/**
 * Resolve `gs://` screenshot URLs inside an {@link E2eReport} to public
 * HTTPS URLs before the report is rendered into PR markdown.
 *
 * GitHub's markdown renderer cannot fetch `gs://` URIs, so any screenshot
 * Muggle uploads to Google Cloud Storage renders as a broken image in the
 * PR body. The prompt service exposes a conversion endpoint that returns a
 * public Firebase Storage download URL (anonymous access via an embedded
 * `?alt=media&token=<uuid>` query string) — we POST each unique gs:// URL
 * to that endpoint and swap the results into a fresh report object.
 *
 * Best-effort by design: if credentials are missing, the prompt service is
 * unreachable, or any single URL fails to resolve, the CLI logs a warning
 * to stderr and returns the original URL untouched. This function must
 * never throw — the caller is downstream of `E2eReportSchema.parse()` and
 * treating a broken image as a hard CLI failure would regress the happy
 * path unnecessarily.
 */

import axios from "axios";

import type { ICallerCredentials } from "../../../packages/mcps/src/index.js";

import {
  GS_SCHEME,
  IMAGE_PROXY_PREFIX,
  LOG_PREFIX,
  PUBLIC_URL_PATH,
  RESOLVE_TIMEOUT_MS,
  type IPublicUrlResponse,
  type IResolveUrlsOptions,
} from "./resolve-urls-types.js";
import type { E2eReport, Step, TestResult } from "./types.js";

function errMsg (e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isGsUrl (url: string): boolean {
  return url.startsWith(GS_SCHEME);
}

/**
 * Wrap a resolved Firebase Storage URL in the public image proxy so GitHub's
 * image proxy (Camo) sees a declared `Content-Type: image/jpeg`. Idempotent:
 * URLs already wrapped with {@link IMAGE_PROXY_PREFIX} are returned untouched.
 *
 * This is a render-time workaround — the proper fix is for the action-script
 * uploader in muggle-ai-teaching-service / the Electron app to set
 * `Content-Type: image/jpeg` at upload time, after which this wrap can be
 * removed without touching every caller.
 */
function wrapInImageProxy (url: string): string {
  if (url.startsWith(IMAGE_PROXY_PREFIX)) {
    return url;
  }
  return `${IMAGE_PROXY_PREFIX}${encodeURIComponent(url)}`;
}

/** Build the auth headers for a prompt service request. Mirrors upstream-client. */
function buildAuthHeaders (credentials: ICallerCredentials): Record<string, string> {
  const headers: Record<string, string> = {};
  if (credentials.bearerToken) {
    headers["Authorization"] = credentials.bearerToken.startsWith("Bearer ")
      ? credentials.bearerToken
      : `Bearer ${credentials.bearerToken}`;
  }
  if (credentials.apiKey) {
    headers["x-api-key"] = credentials.apiKey;
  }
  return headers;
}

/**
 * Collect every unique `gs://` screenshot URL in the report, in insertion order.
 *
 * Walks both `steps[].screenshotUrl` and the optional per-test
 * `endingScreenshotUrl` override — the latter is how a caller surfaces the
 * action script's dedicated summary-step screenshot without stuffing it into
 * `steps[]`.
 */
function collectGsUrls (report: E2eReport): string[] {
  const seen = new Set<string>();
  for (const test of report.tests) {
    for (const step of test.steps) {
      if (isGsUrl(step.screenshotUrl)) {
        seen.add(step.screenshotUrl);
      }
    }
    if (test.endingScreenshotUrl && isGsUrl(test.endingScreenshotUrl)) {
      seen.add(test.endingScreenshotUrl);
    }
  }
  return Array.from(seen);
}

/**
 * Resolve a single gs:// URL via the prompt service. Returns the HTTPS URL
 * on success and `null` on any error (logging the reason to stderr).
 */
async function resolveOne (
  gsUrl: string,
  baseUrl: string,
  headers: Record<string, string>,
  stderrWrite: (s: string) => void,
): Promise<string | null> {
  try {
    const response = await axios.post<IPublicUrlResponse>(
      `${baseUrl}${PUBLIC_URL_PATH}`,
      { resourceUrl: gsUrl },
      {
        headers: { ...headers, "Content-Type": "application/json" },
        timeout: RESOLVE_TIMEOUT_MS,
        validateStatus: () => true,
      },
    );
    if (response.status === 200
      && response.data
      && typeof response.data.resourceUrl === "string"
      && response.data.resourceUrl.length > 0) {
      return response.data.resourceUrl;
    }
    const reason = response.status !== 200
      ? `HTTP ${response.status}`
      : "missing resourceUrl in response";
    stderrWrite(`${LOG_PREFIX}: failed to resolve ${gsUrl}: ${reason}\n`);
    return null;
  } catch (err) {
    stderrWrite(`${LOG_PREFIX}: failed to resolve ${gsUrl}: ${errMsg(err)}\n`);
    return null;
  }
}

/**
 * Return a new `Step` whose `screenshotUrl` has been swapped through the
 * resolution map when a mapping exists. Steps with no mapping (including
 * every https:// step) are returned as-is to keep the diff minimal.
 */
function remapStep (step: Step, urlMap: Map<string, string>): Step {
  const resolved = urlMap.get(step.screenshotUrl);
  if (!resolved) {
    return step;
  }
  return { ...step, screenshotUrl: resolved };
}

/**
 * Return a new `TestResult` with freshly remapped `steps` and, if present,
 * a freshly remapped `endingScreenshotUrl`. Preserves every other field
 * (and the discriminated `status` so the zod union stays valid) via a
 * shallow spread.
 */
function remapTest (test: TestResult, urlMap: Map<string, string>): TestResult {
  const remapped: TestResult = {
    ...test,
    steps: test.steps.map((s) => remapStep(s, urlMap)),
  };
  if (test.endingScreenshotUrl) {
    const resolved = urlMap.get(test.endingScreenshotUrl);
    if (resolved) {
      remapped.endingScreenshotUrl = resolved;
    }
  }
  return remapped;
}

/**
 * Walk the report, POST every unique gs:// screenshot URL to the prompt
 * service's publicUrl endpoint in parallel, and return a new report with
 * the resolved HTTPS URLs swapped in. Never mutates the input report.
 *
 * On missing credentials or unexpected errors, logs a single stderr line
 * and returns the original report unchanged.
 */
export async function resolveGsScreenshotUrls (
  report: E2eReport,
  opts: IResolveUrlsOptions,
): Promise<E2eReport> {
  const { stderrWrite } = opts;
  try {
    const gsUrls = collectGsUrls(report);
    if (gsUrls.length === 0) {
      return report;
    }

    // Dynamic import keeps the heavy `@muggleai/mcp` barrel (logger, config,
    // auth) out of the build-pr-section happy path when there is nothing to
    // resolve, and lets tests that don't touch gs:// URLs skip mocking it.
    const mcps = await import("../../../packages/mcps/src/index.js");
    const credentials = await mcps.getCallerCredentialsAsync();
    if (!credentials.bearerToken && !credentials.apiKey) {
      stderrWrite(
        `${LOG_PREFIX}: no credentials available; run 'muggle login' to enable automatic gs:// URL resolution. `
        + `Screenshots will render as broken images in GitHub.\n`,
      );
      return report;
    }

    const baseUrl = mcps.getConfig().e2e.promptServiceBaseUrl;
    const headers = buildAuthHeaders(credentials);

    const resolved = await Promise.all(
      gsUrls.map((gsUrl) => resolveOne(gsUrl, baseUrl, headers, stderrWrite)),
    );

    const urlMap = new Map<string, string>();
    let failureCount = 0;
    for (let i = 0; i < gsUrls.length; i++) {
      const https = resolved[i];
      if (https) {
        // Wrap every resolved URL in the public image proxy so GitHub's Camo
        // sees a proper Content-Type: image/jpeg header. See the note on
        // IMAGE_PROXY_PREFIX in resolve-urls-types.ts for the root cause.
        urlMap.set(gsUrls[i]!, wrapInImageProxy(https));
      } else {
        failureCount++;
      }
    }

    if (failureCount > 0) {
      stderrWrite(
        `${LOG_PREFIX}: ${failureCount}/${gsUrls.length} gs:// URLs could not be resolved; `
        + `those screenshots will render as broken images in GitHub\n`,
      );
    }

    if (urlMap.size === 0) {
      return report;
    }

    return {
      ...report,
      tests: report.tests.map((t) => remapTest(t, urlMap)),
    };
  } catch (err) {
    stderrWrite(
      `${LOG_PREFIX}: unexpected error while resolving gs:// URLs: ${errMsg(err)}; `
      + `continuing with original report\n`,
    );
    return report;
  }
}
