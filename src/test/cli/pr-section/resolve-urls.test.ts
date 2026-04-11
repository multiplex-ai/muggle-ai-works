/**
 * Tests for `resolveGsScreenshotUrls`. Mocks axios plus the `@muggleai/mcp`
 * helpers the resolver depends on (`getCallerCredentialsAsync`, `getConfig`).
 *
 * Each scenario seeds axios's `post` response (or rejection) and checks the
 * three observable outputs: (1) the returned report object, (2) the URL set
 * passed to axios, (3) the lines written to the injected `stderrWrite` sink.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock("../../../../packages/mcps/src/index.js", () => ({
  getCallerCredentialsAsync: vi.fn(),
  getConfig: vi.fn(),
}));

import axios from "axios";

import { resolveGsScreenshotUrls } from "../../../cli/pr-section/resolve-urls.js";
import { IMAGE_PROXY_PREFIX } from "../../../cli/pr-section/resolve-urls-types.js";
import type { E2eReport } from "../../../cli/pr-section/types.js";
import {
  getCallerCredentialsAsync,
  getConfig,
} from "../../../../packages/mcps/src/index.js";

/** Build the expected image-proxy-wrapped form of a resolved URL. */
function wrapped (url: string): string {
  return `${IMAGE_PROXY_PREFIX}${encodeURIComponent(url)}`;
}

const mockedAxiosPost = vi.mocked(axios.post);
const mockedGetCredentials = vi.mocked(getCallerCredentialsAsync);
const mockedGetConfig = vi.mocked(getConfig);

const BASE_URL = "https://prompt.example.invalid";
const PUBLIC_URL_ENDPOINT = `${BASE_URL}/v1/protected/storage/publicUrl`;

function makeConfig() {
  return {
    serverName: "test",
    serverVersion: "0.0.0",
    logLevel: "silent",
    auth0: { domain: "", clientId: "", audience: "", scope: "" },
    e2e: {
      promptServiceBaseUrl: BASE_URL,
      requestTimeoutMs: 1000,
      workflowTimeoutMs: 1000,
    },
    localQa: {} as never,
  } as never;
}

function makeReport(steps: Array<{ screenshotUrl: string }>): E2eReport {
  return {
    projectId: "p1",
    tests: [
      {
        name: "A",
        testCaseId: "tc-a",
        runId: "r-a",
        viewUrl: "https://example.com/a",
        status: "passed",
        steps: steps.map((s, i) => ({
          stepIndex: i,
          action: `step ${i}`,
          screenshotUrl: s.screenshotUrl,
        })),
      },
    ],
  };
}

function makeStderr() {
  const lines: string[] = [];
  return {
    lines,
    write: (s: string) => {
      lines.push(s);
    },
  };
}

describe("resolveGsScreenshotUrls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConfig.mockReturnValue(makeConfig());
  });

  it("returns the report unchanged when there are no gs:// URLs", async () => {
    const report = makeReport([
      { screenshotUrl: "https://cdn.example.com/a0.png" },
      { screenshotUrl: "https://cdn.example.com/a1.png" },
    ]);
    const stderr = makeStderr();

    const result = await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    expect(result).toBe(report);
    expect(result.tests[0]!.steps).toBe(report.tests[0]!.steps);
    expect(mockedAxiosPost).not.toHaveBeenCalled();
    expect(mockedGetCredentials).not.toHaveBeenCalled();
    expect(stderr.lines).toEqual([]);
  });

  it("only resolves gs:// URLs and leaves https:// URLs alone; resolved URLs are image-proxy-wrapped", async () => {
    mockedGetCredentials.mockResolvedValue({ bearerToken: "tkn" });
    const firebaseUrl = "https://firebasestorage.googleapis.com/v0/b/bucket/o/a.jpg?alt=media&token=abc";
    mockedAxiosPost.mockResolvedValue({
      status: 200,
      data: { resourceUrl: firebaseUrl },
    });
    const report = makeReport([
      { screenshotUrl: "https://cdn.example.com/https.png" },
      { screenshotUrl: "gs://bucket/a.jpg" },
    ]);
    const stderr = makeStderr();

    const result = await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockedAxiosPost).toHaveBeenCalledWith(
      PUBLIC_URL_ENDPOINT,
      { resourceUrl: "gs://bucket/a.jpg" },
      expect.anything(),
    );
    // Untouched https:// stays untouched.
    expect(result.tests[0]!.steps[0]!.screenshotUrl).toBe("https://cdn.example.com/https.png");
    // Resolved gs:// is wrapped through the public image proxy so Camo sees image/jpeg.
    expect(result.tests[0]!.steps[1]!.screenshotUrl).toBe(wrapped(firebaseUrl));
    expect(stderr.lines).toEqual([]);
    // Report is a fresh object (not mutated).
    expect(result).not.toBe(report);
  });

  it("wraps endingScreenshotUrl through the image proxy too (surfacing the action script's summary step)", async () => {
    mockedGetCredentials.mockResolvedValue({ bearerToken: "tkn" });
    const firebaseUrl = "https://firebasestorage.googleapis.com/v0/b/bucket/o/summary.jpg?alt=media&token=s";
    mockedAxiosPost.mockResolvedValue({ status: 200, data: { resourceUrl: firebaseUrl } });

    const report: E2eReport = {
      projectId: "p1",
      tests: [
        {
          name: "A",
          testCaseId: "tc-a",
          runId: "r-a",
          viewUrl: "https://example.com/a",
          status: "passed",
          steps: [
            { stepIndex: 0, action: "navigate", screenshotUrl: "https://cdn.example.com/step0.png" },
          ],
          endingScreenshotUrl: "gs://bucket/summary.jpg",
          endingScreenshotCaption: "Goal achieved",
        },
      ],
    };
    const stderr = makeStderr();

    const result = await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    // The summary-step URL was the only gs:// in the report, and it was sent to the resolver.
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockedAxiosPost).toHaveBeenCalledWith(
      PUBLIC_URL_ENDPOINT,
      { resourceUrl: "gs://bucket/summary.jpg" },
      expect.anything(),
    );
    // endingScreenshotUrl is resolved and then wrapped through the image proxy.
    expect(result.tests[0]!.endingScreenshotUrl).toBe(wrapped(firebaseUrl));
    // The non-gs step URL is left alone.
    expect(result.tests[0]!.steps[0]!.screenshotUrl).toBe("https://cdn.example.com/step0.png");
    // Caption passes through unchanged.
    expect(result.tests[0]!.endingScreenshotCaption).toBe("Goal achieved");
  });

  it("logs a login hint and skips HTTP calls when no credentials are available", async () => {
    mockedGetCredentials.mockResolvedValue({});
    const report = makeReport([{ screenshotUrl: "gs://bucket/x.jpg" }]);
    const stderr = makeStderr();

    const result = await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    expect(result).toBe(report);
    expect(mockedAxiosPost).not.toHaveBeenCalled();
    expect(stderr.lines).toHaveLength(1);
    expect(stderr.lines[0]).toMatch(/muggle login/);
    expect(stderr.lines[0]).toMatch(/build-pr-section:/);
  });

  it("sends Authorization: Bearer when credentials contain a bearer token", async () => {
    mockedGetCredentials.mockResolvedValue({ bearerToken: "my-jwt" });
    mockedAxiosPost.mockResolvedValue({
      status: 200,
      data: { resourceUrl: "https://example.com/resolved.jpg" },
    });
    const report = makeReport([{ screenshotUrl: "gs://bucket/x.jpg" }]);
    const stderr = makeStderr();

    await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
    const [, , config] = mockedAxiosPost.mock.calls[0]!;
    expect(config).toBeDefined();
    const headers = (config as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe("Bearer my-jwt");
    expect(headers["x-api-key"]).toBeUndefined();
    expect((config as { timeout: number }).timeout).toBe(10_000);
    expect((config as { validateStatus: (s: number) => boolean }).validateStatus(500)).toBe(true);
  });

  it("sends x-api-key when credentials contain an api key", async () => {
    mockedGetCredentials.mockResolvedValue({ apiKey: "sk-test" });
    mockedAxiosPost.mockResolvedValue({
      status: 200,
      data: { resourceUrl: "https://example.com/resolved.jpg" },
    });
    const report = makeReport([{ screenshotUrl: "gs://bucket/x.jpg" }]);
    const stderr = makeStderr();

    await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    const [, , config] = mockedAxiosPost.mock.calls[0]!;
    const headers = (config as { headers: Record<string, string> }).headers;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers.Authorization).toBeUndefined();
  });

  it("swaps successful URLs (proxy-wrapped) and keeps failed URLs (per-URL 401)", async () => {
    mockedGetCredentials.mockResolvedValue({ bearerToken: "tkn" });
    mockedAxiosPost.mockImplementation(async (_url: string, body: unknown) => {
      const { resourceUrl } = body as { resourceUrl: string };
      if (resourceUrl === "gs://bucket/ok.jpg") {
        return { status: 200, data: { resourceUrl: "https://cdn.example.com/ok.jpg" } };
      }
      return { status: 401, data: { error: "unauthorized" } };
    });
    const report = makeReport([
      { screenshotUrl: "gs://bucket/ok.jpg" },
      { screenshotUrl: "gs://bucket/bad.jpg" },
    ]);
    const stderr = makeStderr();

    const result = await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    expect(result.tests[0]!.steps[0]!.screenshotUrl).toBe(wrapped("https://cdn.example.com/ok.jpg"));
    expect(result.tests[0]!.steps[1]!.screenshotUrl).toBe("gs://bucket/bad.jpg");

    const joined = stderr.lines.join("");
    expect(joined).toMatch(/failed to resolve gs:\/\/bucket\/bad\.jpg: HTTP 401/);
    expect(joined).toMatch(/1\/2 gs:\/\/ URLs could not be resolved/);
  });

  it("treats a network error on one URL as a per-URL failure (warn and continue)", async () => {
    mockedGetCredentials.mockResolvedValue({ bearerToken: "tkn" });
    mockedAxiosPost.mockImplementation(async (_url: string, body: unknown) => {
      const { resourceUrl } = body as { resourceUrl: string };
      if (resourceUrl === "gs://bucket/ok.jpg") {
        return { status: 200, data: { resourceUrl: "https://cdn.example.com/ok.jpg" } };
      }
      throw new Error("ECONNRESET");
    });
    const report = makeReport([
      { screenshotUrl: "gs://bucket/ok.jpg" },
      { screenshotUrl: "gs://bucket/bad.jpg" },
    ]);
    const stderr = makeStderr();

    const result = await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    expect(result.tests[0]!.steps[0]!.screenshotUrl).toBe(wrapped("https://cdn.example.com/ok.jpg"));
    expect(result.tests[0]!.steps[1]!.screenshotUrl).toBe("gs://bucket/bad.jpg");

    const joined = stderr.lines.join("");
    expect(joined).toMatch(/failed to resolve gs:\/\/bucket\/bad\.jpg: ECONNRESET/);
    expect(joined).toMatch(/1\/2 gs:\/\/ URLs could not be resolved/);
  });

  it("catches unexpected errors from getCallerCredentialsAsync and returns the original report", async () => {
    mockedGetCredentials.mockRejectedValue(new Error("config corrupt"));
    const report = makeReport([{ screenshotUrl: "gs://bucket/x.jpg" }]);
    const stderr = makeStderr();

    const result = await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    expect(result).toBe(report);
    expect(mockedAxiosPost).not.toHaveBeenCalled();
    expect(stderr.lines).toHaveLength(1);
    expect(stderr.lines[0]).toMatch(/unexpected error/);
    expect(stderr.lines[0]).toMatch(/config corrupt/);
  });

  it("deduplicates identical gs:// URLs across tests so each is resolved exactly once", async () => {
    mockedGetCredentials.mockResolvedValue({ bearerToken: "tkn" });
    mockedAxiosPost.mockResolvedValue({
      status: 200,
      data: { resourceUrl: "https://cdn.example.com/dup.jpg" },
    });
    const report: E2eReport = {
      projectId: "p1",
      tests: [
        {
          name: "A",
          testCaseId: "tc-a",
          runId: "r-a",
          viewUrl: "https://example.com/a",
          status: "passed",
          steps: [
            { stepIndex: 0, action: "one", screenshotUrl: "gs://bucket/dup.jpg" },
          ],
        },
        {
          name: "B",
          testCaseId: "tc-b",
          runId: "r-b",
          viewUrl: "https://example.com/b",
          status: "passed",
          steps: [
            { stepIndex: 0, action: "two", screenshotUrl: "gs://bucket/dup.jpg" },
          ],
        },
      ],
    };
    const stderr = makeStderr();

    const result = await resolveGsScreenshotUrls(report, { stderrWrite: stderr.write });

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
    expect(result.tests[0]!.steps[0]!.screenshotUrl).toBe(wrapped("https://cdn.example.com/dup.jpg"));
    expect(result.tests[1]!.steps[0]!.screenshotUrl).toBe(wrapped("https://cdn.example.com/dup.jpg"));
    expect(stderr.lines).toEqual([]);
  });
});
